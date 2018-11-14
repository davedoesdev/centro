/*eslint-env node */

/**
 * Centro server class
 * @module centro-js/lib/server
 */
"use strict";

var crypto = require('crypto'),
    async = require('async'),
    frame = require('frame-stream'),
    EventEmitter = require('events').EventEmitter,
    util = require('util'),
    QlobberFSQ = require('qlobber-fsq').QlobberFSQ,
    MQlobberServer = require('mqlobber').MQlobberServer,
    AccessControl = require('mqlobber-access-control').AccessControl,
    server_config = require('./server_config'),
    Ajv = require('ajv'),
    ajv = new Ajv();

exports.version = require('./version');

var max_settimeout = Math.pow(2, 31) - 1;

function schedule(t, update, f)
{
    var now = new Date().getTime();

    if (t > now)
    {
        update(setTimeout(function ()
        {
            schedule(t, update, f);
        }, Math.min(t - now, max_settimeout)));
    }
    else
    {
        update(setTimeout(f, 0));
    }
}

function read_frame(config, s, cb)
{
    var in_stream = frame.decode(config);

    function cleanup()
    {
        s.removeListener('end', end);
        s.removeListener('close', end);
        s.removeListener('readable', onread);
    }

    function end()
    {
        cleanup();
        cb(new Error('ended before frame'));
    }

    s.on('end', end);
    s.on('close', end);

    function done(v)
    {
        if (v)
        {
            throw v;
        }
    }

    function onread()
    {
        while (true) //eslint-disable-line no-constant-condition
        {
            /*jshint validthis: true */
            var data = this.read();

            if (data === null)
            {
                break;
            }

            var buffer = in_stream.buffer;

            try
            {
                in_stream.push = done;
                in_stream._transform(data, null, done);
            }
            catch (v)
            {
                cleanup();

                if (v instanceof Buffer)
                {
                    var rest = buffer ? Buffer.concat([buffer, data]) : data;
                    s.unshift(rest.slice(in_stream.opts.lengthSize + v.length));
                    return cb(null, v);
                }

                cb(v);
            }
        }
    }

    s.on('readable', onread);
}

/**
 * Create a server which publishes and subscribes to messages on behalf of
 * clients.
 *
 * @class
 * @extends events.EventEmitter
 *
 * @param {Object} config - Configuration options. This supports all the options supported by {@link https://github.com/davedoesdev/mqlobber#mqlobberserverfsq-stream-options|MQlobberServer} and {@link https://github.com/davedoesdev/mqlobber-access-control#accesscontroloptions|AccessControl} as well as the following:
 * @param {string|Object} [config.transport] - Specifies which transport to load into the server. This should be either the transport's name or its configuration, with its name in the `server` property.
 * @param {(string|Object)[]} [config.transports] - Specifies multiple transports to load into the server.
 * @param {Function} [config.authorize] - Function for creating an object which can authorize {@link http://self-issued.info/docs/draft-ietf-oauth-json-web-token.html|JSON Web Tokens} presented by clients. Defaults to {@link https://github.com/davedoesdev/authorize-jwt#moduleexportsconfig-cb|authorize-jwt}. If you supply your own, it must comply with authorize-jwt's API. `authorize_config` or `config` is passed as the first argument.
 * @param {Object} [config.authorize_config] - Configuration specific to `config.authorize`.
 * @param {string[]} config.allowed_algs - Which JWT algorithms are allowed. Clients which present tokens which aren't signed with one of these algorithms are rejected. You must supply this list.
 * @param {QlobberFSQ} [config.fsq] - {@link https://github.com/davedoesdev/qlobber-fsq#qlobberfsqoptions|QlobberFSQ} instance for handling messages. Defaults to a new instance, passing `fsq_config` or `config` to the constructor.
 * @param {Object} [config.fsq_config] - Configuration specific to `config.fsq`.
 * @param {string} [config.realm=centro] - When authorization of a client fails, the transport is given information it can (optionally) use when rejecting the connection. This includes a HTTP Bearer Authentication header specifying this realm.
 * @param {integer} [config.max_tokens=10] - Maximum number of authorization tokens each client is allowed to present.
 * @param {integer} [config.max_token_length=1MiB] - Maximum size of authorization token each client is allowed to present.
 * @param {integer} [config.max_topic_length=32KiB] - Maximum length of topics the client can specify, in subscription and publish requests and in the authorization token.
 * @param {integer} [config.max_issuer_length=128] - Maximum length of the `iss` claim in authorization tokens.
 * @param {integer} [config.max_subscribe_topics=1000] - Maximum number of topics that `subscribe` claims in authorization tokens can contain. These claims specify to which topics client which present them are pre-subscribed.
 * @param {integer} [config.max_allow_publish_topics=1000] - Maximum number of topics that `access_control.publish.allow` claims in authorization tokens can contain. These claims are passed to {@link https://github.com/davedoesdev/mqlobber-access-control#accesscontroloptions|AccessControl} and specify to which topics clients which present them can publish messages.
 * @param {integer} [config.max_disallow_publish_topics=1000] - Maximum number of topics that `access_control.publish.disallow` claims in authorization tokens can contain. These claims are passed to {@link https://github.com/davedoesdev/mqlobber-access-control#accesscontroloptions|AccessControl} and specify to which topics clients which present them cannot publish messages.
 * @param {integer} [config.max_allow_subscribe_topics=1000] - Maximum number of topics that `access_control.subscribe.allow` claims in authorization tokens can contain. These claims are passed to {@link https://github.com/davedoesdev/mqlobber-access-control#accesscontroloptions|AccessControl} and specify to which topics clients which present them cannot subscribe.
 * @param {integer} [config.max_disallow_subscribe_topics=1000] - Maximum number of topics that `access_control.subscribe.disallow` claims in authorization tokens can contain. These claims are passed to {@link https://github.com/davedoesdev/mqlobber-access-control#accesscontroloptions|AccessControl} and specify to which topics clients which present them cannot subscribe.
 * @param {integer} [config.max_block_topics=1000] - Maximum number of topics that `access_control.block` claims in authorization tokens can contain. These claims are passed to {@link https://github.com/davedoesdev/mqlobber-access-control#accesscontroloptions|AccessControl} and specify which messages aren't delivered to clients which present them.
 * @param {integer} [config.max_presence_data_length=1MiB] - Maximum length of `presence.connect.data` and `presence.disconnect.data` claims in authorization tokens can contain. The `presence` claims specify messages to send when clients which present them connect and disconnect.
 */
exports.CentroServer = function CentroServer(config)
{
    EventEmitter.call(this);

    /**
     * {@link https://github.com/davedoesdev/qlobber-fsq#qlobberfsqoptions|QlobberFSQ} instance being used to handle messages.
     *
     * @member {QlobberFSQ}
     */
    this.fsq = null;

    /**
      * Operations you can perform on transports you specified when constructing {@link centro-js/lib/server.CentroServer|CentroServer}. Transports can define their own operations in addition to `close`. Indexable by position or transport name.
     *
     * @member {{close: centro-js/lib/server.closeCallback}[]}
     */
    this.transport_ops = null;

    config = server_config.config_with_defaults(config);

    function compile(required)
    {
        return ajv.compile(server_config.authz_token_schema(config, required));
    }

    var validate = compile(['iss', 'access_control']),
        validate_anon = compile(['access_control']);

    this.transport_ops = [];
    this._pending_authz_destroys = new Set();
    this._connections = new Map();
    this._connids = new Map();
    this._config = config;
    this._closing = false;
    this._closed = false;
    this._close_cb = null;
    this._ready = false;

    var ths = this,
        separator;

    function error(err)
    {
        /*jshint validthis: true */
        if (err)
        {
            ths.emit('error', err, this);
        }
        return err;
    }
    this._error = error;

    function warning(err)
    {
        /*jshint validthis: true */
        if (err && !ths.emit('warning', err, this))
        {
            console.error(err); //eslint-disable-line no-console
        }
    }
    this._warning = warning;

    function change(uri, rev)
    {
        warning(new Error('uri revision change: ' + uri));

        var conns = ths._connections.get(uri);

        if (conns !== undefined)
        {
            for (var conn of conns)
            {
                if (conn.rev !== rev)
                {
                    // Remove while iterating on ES6 Sets is consistent
                    conn.destroy();
                }
            }
        }
    }

    function authorize(err, default_authz)
    {
        if (error(err))
        {
            return;
        }

        if (default_authz.keystore)
        {
            default_authz.keystore.on('change', change);
        }

        var transports = config.transports || config.transport;

        if ((typeof transports === 'string') ||
            (typeof transports[Symbol.iterator] !== 'function'))
        {
            transports = [transports];
        }

        function run_transport(config, authz, transport, name, keystore_to_close, next)
        {
            function transport_authorize(obj, destroy, onclose, cb2)
            {
                var authz_ended = false;

                function cb(err, handshakes, tokens)
                {
                    warning(err);

                    if (err && !obj.url)
                    {
                        var hsdata = new Buffer(JSON.stringify(
                        {
                            error: err.message,
                            version: exports.version
                        }));

                        // bpmux _send_handshake
                        var buf = new Buffer(1 + 4 + 4 + hsdata.length);
                        buf.writeUInt8(1, 0, true);
                        buf.writeUInt32BE(0, 1, true);
                        buf.writeUInt32BE(0, 5, true);
                        hsdata.copy(buf, 9);

                        // write frame
                        var out_stream = frame.encode(config);
                        out_stream._pushFrameData = function (bufs)
                        {
                            for (var buf of bufs)
                            {
                                obj.write(buf);
                            }
                        };
                        out_stream.end(buf);
                    }

                    ths.emit('authz_end', err, handshakes, tokens, obj, config);

                    if (ths._pending_authz_destroys.delete(destroy))
                    {
                        cb2(err, handshakes, tokens);
                    }
                }

                function got_tokens(err, tokens)
                {
                    if (authz_ended)
                    {
                        return;
                    }
                    authz_ended = true;

                    if (err)
                    {
                        return cb(ths._authz_error(err));
                    }

                    if (tokens === undefined)
                    {
                        return cb(ths._authz_error('tokens missing'));
                    }

                    if (typeof tokens === 'string')
                    {
                        tokens = tokens.split(',').filter(function (t)
                        {
                            return t;
                        });
                    }

                    if (tokens.length === 0)
                    {
                        return cb(ths._authz_error('no tokens'));
                    }

                    var max_tokens = authz.keystore ? config.max_tokens : 1;

                    if (max_tokens && (tokens.length > max_tokens))
                    {
                        return cb(ths._authz_error('too many tokens'));
                    }

                    if (!authz.keystore && (tokens[0] === 'X'))
                    {
                        return cb(null, [{
                            payload: {
                                access_control: {
                                    subscribe: { allow: ['#'], disallow: [] },
                                    publish: { allow: ['#'], disallow: [] }
                                }
                            }
                        }]);
                    }

                    async.mapSeries(tokens, async.ensureAsync(function (token, cb)
                    {
                        if (config.max_token_length && (token.length > config.max_token_length))
                        {
                            return cb(new Error('token too long'));
                        }

                        authz.authorize(token, config.allowed_algs, function (err, payload, uri, rev)
                        {
                            if (err)
                            {
                                return cb(err);
                            }

                            cb(null,
                            {
                                payload: payload,
                                uri: uri,
                                rev: rev
                            });
                        });
                    }), function (err, handshakes)
                    {
                        if (err)
                        {
                            return cb(ths._authz_error(err));
                        }

                        var uris = new Set();

                        for (var hs of handshakes)
                        {
                            if (authz.keystore)
                            {
                                if (!validate(hs.payload))
                                {
                                    return cb(ths._authz_error(ajv.errorsText(validate.errors)));
                                }
                            }
                            else if (!validate_anon(hs.payload))
                            {
                                return cb(ths._authz_error(ajv.errorsText(validate_anon.errors)));
                            }

                            if (!authz.keystore)
                            {
                                continue;
                            }

                            if (uris.has(hs.uri))
                            {
                                return cb(ths._authz_error('duplicate URI: ' + hs.uri));
                            }

                            uris.add(hs.uri);
                        }

                        cb(null, handshakes, tokens);
                    });
                }

                obj.on('error', warning);
                ths._pending_authz_destroys.add(destroy);

                ths.emit('authz_start', function (err)
                {
                    got_tokens(err || new Error('cancelled'));
                }, onclose, obj, config);

                if (obj.url)
                {
                    authz.get_authz_data(obj, function (err, info, tokens)
                    {
                        got_tokens(err, tokens);
                    });
                }
                else
                {
                    read_frame(config, obj, function (err, v)
                    {
                        got_tokens(err, err ? undefined : v.toString());
                    });
                }
            }

            function transport_connected(handshakes, stream, destroy, onclose)
            {
                stream.on('error', warning);

                var connid,
                    mqserver,
                    hs_conns = new Set(),
                    presence = new Map(),
                    ack_prefixes = new Map(),
                    closed = false,
                    destroyed = false;

                function dstroy()
                {
                    if (!destroyed && !closed)
                    {
                        try
                        {
                            dstroy.destroy(mqserver);
                        }
                        catch (ex)
                        {
                            warning(ex);
                        }

                        destroyed = true;
                    }
                }
                // for testing
                dstroy.destroy = destroy;
                dstroy.stream = stream;

                if (ths._closing)
                {
                    return dstroy();
                }

                do
                {
                    connid = crypto.randomBytes(32).toString('hex');
                }
                while (ths._connids.has(connid));

                function replace(topic)
                {
                    return topic.split('${self}').join(connid);
                }

                ths._connids.set(connid, dstroy);

                function make_update(conn)
                {
                    return function (timeout)
                    {
                        conn.timeout = timeout;
                    };
                }

                function make_destroy(conn)
                {
                    return function ()
                    {
                        conn.timeout = null;
                        ths.emit('expired', connid);
                        dstroy();
                    };
                }

                function conn_closed()
                {
                    closed = true;

                    for (var conn of hs_conns)
                    {
                        if (conn.timeout)
                        {
                            clearTimeout(conn.timeout);
                        }

                        if (!authz.keystore)
                        {
                            continue;
                        }

                        var conns = ths._connections.get(conn.uri);

                        if (conns === undefined)
                        {
                            warning(new Error('unknown uri on closed connection: ' + conn.uri));
                            continue;
                        }

                        conns.delete(conn);

                        if (conns.size === 0)
                        {
                            ths._connections.delete(conn.uri);
                        }
                    }

                    hs_conns.clear();

                    ths._connids.delete(connid);

                    ths.emit('disconnect', connid);

                    for (var entry of presence)
                    {
                        var prefix = entry[0],
                            p = entry[1];

                        if (authz.keystore)
                        {
                            prefix += separator;
                        }

                        var options = {};

                        options.single = p.disconnect.single;

                        if (p.disconnect.ttl !== undefined)
                        {
                            options.ttl = Math.min(
                                    options.single ? ths.fsq._single_ttl : ths.fsq._multi_ttl,
                                    p.disconnect.ttl * 1000);
                        }

                        var s = ths.fsq.publish(prefix + replace(p.disconnect.topic), options);

                        if (p.disconnect.data !== undefined)
                        {
                            s.write(replace(p.disconnect.data));
                        }

                        s.end();
                    }

                    if (ths._connids.size === 0)
                    {
                        ths.emit('empty');
                    }
                }

                onclose(conn_closed);

                function process_handshake(hs, cb)
                {
                    if (closed)
                    {
                        return cb(new Error('closed'));
                    }

                    var prefix;

                    if (authz.keystore)
                    {
                        // Ensure issuer has no separators
                        prefix = crypto.createHash('sha256')
                                .update(hs.payload.iss)
                                .digest('hex');
                        hs.prefix = prefix + separator;
                    }
                    else
                    {
                        prefix = '';
                        hs.prefix = prefix;
                    }

                    if (hs.payload.ack)
                    {
                        ack_prefixes.set(prefix, hs.payload.ack.prefix);
                    }

                    if (hs.payload.presence)
                    {
                        presence.set(prefix, hs.payload.presence);
                    }

                    var conn = {
                        destroy: dstroy
                    };
                        
                    hs_conns.add(conn);

                    if (hs.payload.exp !== undefined)
                    {
                        schedule(hs.payload.exp * 1000, 
                                 make_update(conn),
                                 make_destroy(conn));
                    }
                        
                    if (!authz.keystore)
                    {
                        return cb();
                    }

                    conn.uri = hs.uri;
                    conn.rev = hs.rev;

                    var conns = ths._connections.get(hs.uri);

                    if (conns === undefined)
                    {
                        conns = new Set();
                        ths._connections.set(hs.uri, conns);
                    }

                    conns.add(conn);

                    function got_pub_key(err, pub_key, issuer_id, rev)
                    {
                        if (err)
                        {
                            return cb(err);
                        }

                        if (hs.rev !== rev)
                        {
                            return cb(new Error('uri revision has changed: ' + hs.uri));
                        }

                        cb();
                    }
 
                    authz.keystore.get_pub_key_by_uri(hs.uri, got_pub_key);
                }
 
                function processed_handshakes(err)
                {
                    if (err)
                    {
                        warning(err);
                        return dstroy();
                    }

                    if (closed)
                    {
                        warning(new Error('closed'));
                        return;
                    }

                    function AggregateTopics(action, type)
                    {
                        this.action = action;
                        this.type = type;
                    }

                    AggregateTopics.prototype[Symbol.iterator] = function* ()
                    {
                        for (var hs of handshakes)
                        {
                            var topics = hs.payload.access_control[this.action];
                            if (this.type)
                            {
                                topics = topics[this.type];
                            }
                            topics = topics || [];
                            for (var topic of topics)
                            {
                                yield hs.prefix + replace(topic);
                            }
                        }
                    };

                    function aggregate_bool(action, type, dflt)
                    {
                        for (var hs of handshakes)
                        {
                            var b = !!hs.payload.access_control[action][type];
                            if (b !== dflt)
                            {
                                return b;
                            }
                        }
                        return dflt;
                    }

                    var access_control = new AccessControl(
                    {
                        publish: {
                            allow: new AggregateTopics('publish', 'allow'),
                            disallow: new AggregateTopics('publish', 'disallow'),
                            disallow_single: aggregate_bool('publish', 'disallow_single', false),
                            disallow_multi: aggregate_bool('publish', 'disallow_multi', false),
                            max_data_length: config.max_publish_data_length,
                            max_publications: config.max_publications
                        },
                        subscribe: {
                            allow: new AggregateTopics('subscribe', 'allow'),
                            disallow: new AggregateTopics('subscribe', 'disallow'),
                            max_subscriptions: config.max_subscriptions
                        },
                        block: new AggregateTopics('block'),
                        max_topic_length:
                            config.max_topic_length === undefined ? undefined :
                            authz.keystore ? (65 + config.max_topic_length) :
                            config.max_topic_length
                    });

                    mqserver = new MQlobberServer(ths.fsq,
                                                  stream,
                                                  config.mqlobber || config);
                    mqserver.on('error', warning);
                    mqserver.on('warning', warning);
                    access_control.attach(mqserver);

                    mqserver.on('backoff', function ()
                    {
                        warning.call(this, new Error('backoff'));
                    });

                    mqserver.on('full', function ()
                    {
                        warning.call(this, new Error('full'));
                    });

                    var subscriptions = [], subscribed = false;

                    for (var hs of handshakes)
                    {
                        if (hs.payload.subscribe)
                        {
                            for (var topic in hs.payload.subscribe)
                            {
                                /* istanbul ignore else */
                                if (hs.payload.subscribe.hasOwnProperty(topic))
                                {
                                    mqserver.subscribe(hs.prefix + replace(topic),
                                    {
                                        subscribe_to_existing: hs.payload.subscribe[topic]
                                    });

                                    subscribed = true;
                                }
                            }
                        }

                        subscriptions.push(hs.payload.subscribe || {});
                    }

                    if (!subscribed)
                    {
                        subscriptions = undefined;
                    }

                    if (ack_prefixes.size > 0)
                    {
                        mqserver.on('ack', function (info)
                        {
                            var pos = -1, prefix = '';

                            if (authz.keystore)
                            {
                                pos = info.topic.indexOf(separator);
                            }

                            if (pos >= 0)
                            {
                                prefix = info.topic.substr(0, pos);
                            }

                            var ack_prefix = ack_prefixes.get(prefix);

                            if (ack_prefix === undefined)
                            {
                                return warning(new Error('unknown prefix on ack topic: ' + info.topic));
                            }

                            if (authz.keystore)
                            {
                                prefix += separator;
                            }

                            ths.fsq.publish(prefix +
                                            replace(ack_prefix) +
                                            info.topic.substr(pos + 1))
                                   .end();
                        });
                    }

                    var prefixes = handshakes.map(function (hs)
                    {
                        return hs.prefix;
                    });

                    ths.emit('pre_connect',
                    {
                        mqserver: mqserver,
                        access_control: access_control,
                        connid: connid,
                        prefixes: prefixes,
                        subscriptions: subscriptions,
                        destroy: dstroy,
                        onclose: onclose,
                        token_infos: handshakes
                    });

                    mqserver.on('handshake', function (hsdata, delay)
                    {
                        if (hsdata.length < 4)
                        {
                            return warning(new Error('short handshake'));
                        }

                        delay()(new Buffer(JSON.stringify(
                        {
                            self: connid,
                            prefixes: prefixes,
                            subscriptions: subscriptions,
                            version: exports.version
                        })));

                        var client_version = hsdata.readUInt32BE(0, true);
                        if (client_version !== exports.version)
                        {
                            warning(new Error('unsupported version: ' + client_version));
                            return dstroy();
                        }

                        ths.emit('connect', connid, hsdata.slice(4));

                        for (var entry of presence)
                        {
                            var prefix = entry[0],
                                p = entry[1];

                            if (authz.keystore)
                            {
                                prefix += separator;
                            }

                            var options = {};

                            options.single = p.connect.single;

                            if (p.connect.ttl !== undefined)
                            {
                                options.ttl = Math.min(
                                        options.single ? ths.fsq._single_ttl : ths.fsq._multi_ttl,
                                        p.connect.ttl * 1000);
                            }

                            var s = ths.fsq.publish(prefix + replace(p.connect.topic), options);

                            if (p.connect.data !== undefined)
                            {
                                s.write(replace(p.connect.data));
                            }

                            s.end();
                        }
                    });
                }
 
                async.eachSeries(handshakes,
                                 async.ensureAsync(process_handshake),
                                 processed_handshakes);
            }

            function transport_ready(err, ops)
            {
                if (err)
                {
                    warning(err);
                    if (keystore_to_close)
                    {
                        return keystore_to_close.close(function (err2)
                        {
                            warning(err2);
                            next(err);
                        });
                    }
                    return next(err);
                }

                if (keystore_to_close)
                {
                    var close = ops.close;
                    ops.close = function (cb)
                    {
                        keystore_to_close.close(function (err2)
                        {
                            warning(err2);
                            close(function (err3)
                            {
                                warning(err3);
                                cb(err2 || err3);
                            });
                        });
                    };
                }

                ops.authz = authz;
                ops.name = name;

                ths.emit('transport_ready', config, ops);

                return next(null, ops);
            }
 
            transport(config,
                      transport_authorize,
                      transport_connected, 
                      transport_ready,
                      error,
                      warning);
        }

        function start_transport2(transport, next)
        {
            if (typeof transport === 'function')
            {
                run_transport(config, default_authz, transport, null, null, next);
            }
            else
            {
                var tconfig = Object.assign({}, config, transport.config);

                if (transport.authorize_config)
                {
                    var aconfig = Object.assign({}, tconfig, transport.authorize_config);

                    aconfig.authorize(aconfig, function (err, authz)
                    {
                        if (err)
                        {
                            return next(err);
                        }

                        run_transport(tconfig, authz, transport.server, transport.name, authz.keystore, next);
                    });
                }
                else
                {
                    run_transport(tconfig, default_authz, transport.server, transport.name, null, next);
                }
            }
        }

        function start_transport(transport, next)
        {
            if (typeof transport === 'string')
            {
                transport = { server: transport };
            }

            if (typeof transport.server === 'string')
            {
                if (transport.name === undefined)
                {
                    transport.name = transport.server;
                }

                transport.server = CentroServer.load_transport(transport.server);
            }

            if (!ths.fsq)
            {
                var fconfig = Object.assign({}, config, config.fsq_config);
                ths.fsq = config.fsq || new QlobberFSQ(fconfig);
                ths.fsq.on('warning', warning);
                ths.fsq.on('error', error);
                separator = ths.fsq._matcher._separator;

                if (!ths.fsq.initialized)
                {
                    return ths.fsq.on('start', function ()
                    {
                        start_transport2(transport, next);
                    });
                }
            }

            start_transport2(transport, next);
        }

        function transports_started(err, transport_ops)
        {
            for (var ops of transport_ops)
            {
                if (ops && ops.name !== undefined)
                {
                    transport_ops[ops.name] = ops;
                }
            }

            ths.transport_ops = transport_ops;
            ths.authz = default_authz;

            process.nextTick(function ()
            {
                ths._ready = !error(err);

                if (ths._close_cb || err)
                {
                    var close_cb = ths._close_cb;
                    ths._close_cb = null;
                    return ths._close(close_cb);
                }

                ths.emit('ready');
            });
        }

        async.mapSeries(transports,
                        async.ensureAsync(start_transport),
                        transports_started);
    }

    process.nextTick(function ()
    {
        var aconfig = Object.assign({}, config, config.authorize_config);
        config.authorize(aconfig, authorize);
    });
};

util.inherits(exports.CentroServer, EventEmitter);

exports.CentroServer.prototype._close = function (cb)
{
    var ths = this;

    function set_cb(f)
    {
        cb = f || function () {};
    }
    set_cb(cb);

    function close_transports(err)
    {
        for (var destroy of ths._pending_authz_destroys)
        {
            try
            {
                destroy();
            }
            catch (ex)
            {
                ths._warning(ex);
            }
        }

        ths._pending_authz_destroys.clear();

        function cont(cb2)
        {
            set_cb(cb2);

            var closed = false,
                transport_ops = ths.transport_ops;

            ths.transport_ops = [];

            function check()
            {
                if (closed && (ths._connids.size === 0))
                {
                    ths._closed = true;
                    ths.emit('close'); 
                    cb();
                }
            }

            async.each(transport_ops, async.ensureAsync(function (ops, cb)
            {
                if (ops)
                {
                    return ops.close(cb);
                }
                cb();
            }), function (err)
            {
                function cont2(cb2)
                {
                    set_cb(cb2);
                    closed = true;
                    check();
                }

                if (err)
                {
                    return cb(err, cont2);
                }

                cont2(cb);
            });

            ths.once('empty', check);

            for (var dstroy of ths._connids.values())
            {
                // Remove while iterating on ES6 Maps is consistent
                dstroy();
            }
        }

        if (err)
        {
            return cb(err, cont);
        }

        cont(cb);
    }

    function close_keystore()
    {
        if (!ths.authz.keystore)
        {
            return close_transports();
        }

        ths.authz.keystore.close(close_transports);
    }

    if (this.fsq)
    {
        if (!this._config.fsq)
        {
            return this.fsq.stop_watching(close_keystore);
        }

        this.fsq.removeListener('warning', this._warning);
        this.fsq.removeListener('error', this._error);
    }

    close_keystore();
};

/**
 * Close the server.
 *
 @param {centro-js/lib/server.closeCallback} cb - Called when the server has been closed.
 */
exports.CentroServer.prototype.close = function (cb)
{
    cb = cb || function () {};

    if (this._closing)
    {
        if (this._closed)
        {
            return cb();
        }

        return this.once('close', cb);
    }

    this._closing = true;

    if (this._ready)
    {
        return this._close(cb);
    }

    this._close_cb = cb;
};

exports.CentroServer.prototype._authz_error = function (err)
{
    if (!err.message)
    {
        err = new Error(String(err));
    }

    this._warning(err);

    return {
        statusCode: 401,
        authenticate: 'Bearer realm="' + this._config.realm + '"',
        message: err.message
    };
};

function pipeline(obj, evname, handler)
{
    var def_evname = 'default_' + evname + '_handler', handlers;

    function next(i, orig_arguments)
    {
        var f = function ()
        {
            // Note: must be synchronous call to next because handlers may
            // be setting up pipes and the pipe chain must be set up before
            // the first reads data.

            var h;

            if (i === handlers.length)
            {
                h = obj[def_evname];
                if (h)
                {
                    h.apply(obj, arguments);
                }
            }
            else
            {
                h = handlers[i];
                var args = Array.prototype.slice.call(arguments);
                h.apply(obj, args.concat(next(i + 1, orig_arguments)));
            }
        };

        f.orig_arguments = orig_arguments;
        return f;
    }

    if (!obj.centro_pipeline_handlers)
    {
        obj.centro_pipeline_handlers = new Map();
    }

    if (!obj.centro_pipeline_handlers.has(evname))
    {
        obj.centro_pipeline_handlers.set(evname, []);

        obj.on(evname, function ()
        {
            next(0, arguments).apply(this, arguments);
        });
    }

    handlers = obj.centro_pipeline_handlers.get(evname);
    handlers.push(handler);
}

exports.CentroServer.prototype.pipeline = pipeline;

/**
 * Attach an extension to the server.
 *
 * @param {Object} ext - Extension to attach.
 * @param {Object} [config] - Configuration to pass to the extension.
 */
exports.CentroServer.prototype.attach_extension = function (ext, config)
{
    ext = ext.call(this, config);

    for (var ev in ext)
    {
        /* istanbul ignore else */
        if (ext.hasOwnProperty(ev))
        {
            this.on(ev, ext[ev]);
        }
    }

    return ext; // for testing
};

exports.CentroServer.load_transport = function (name)
{
    return require('./server_transports/' + name);
};

exports.read_frame = read_frame;
exports.pipeline = pipeline;

/*eslint-disable no-unused-vars */

/**
 * Callback type for server or transport close.
 *
 * @callback closeCallback
 * @memberof centro-js/lib/server
 * @param {?Error} err - Error, if one occurred.
 */
/* istanbul ignore next */
exports._closeCallback = function (err) {};

/**
 * Callback type for cancelling authorization.
 *
 * @callback cancelCallback
 * @memberof centro-js/lib/server
 * @param {?Error} err - Error which led to cancelling the authorization, if available.
 */
/* istanbul ignore next */
exports._cancelCallback = function (err) {};

/**
 * Callback type for registering close handler.
 *
 * @callback oncloseCallback
 * @memberof centro-js/lib/server
 * @param {centro-js/lib/server.closeCallback} cb - Called when close completes.
 */
/* istanbul ignore next */
exports._oncloseCallback = function (cb) {};

/** Callback type for closing a connection.
 *
 * @callback destroyCallback
 * @memberof centro-js/lib/server
 */
/* istanbul ignore next */
exports._destroyCallback = function () {};

/**
 * Ready event. Emitted when the server is ready to accept connections.
 *
 * @event CentroServer#ready
 * @memberof centro-js/lib/server
 */
/* istanbul ignore next */
exports._ready_event = function () {};

/**
 * Transport ready event. Emitted when an individual transport has been loaded
 * and is ready to accept connections.
 *
 * @event CentroServer#transport_ready
 * @memberof centro-js/lib/server
 * @param {Object} config - Configuration you gave to the transport when constructing {@link centro-js/lib/server.CentroServer|CentroServer}.
 * @param {Object} ops - Operations you can perform on the transport, including:
 * @param {centro-js/lib/server.closeCallback} close - Close the transport.
 *
 */
/* istanbul ignore next */
exports._transport_ready_event = function (config, ops) {};

/**
 * Authorization start event. This is the first event emitted when a client
 * connects.
 *
 * @event CentroServer#authz_start
 * @memberof centro-js/lib/server
 * @param {centro-js/lib/server.cancelCallback} cancel - Call this to cancel authorization.
 * @param {centro-js/lib/server.oncloseCallback} onclose - Call this to register a handler when the connection is closed.
 * @param {Object} obj - What's being authorized. This is either a HTTP request (with a `url` property) or a stream.
 * @param {Object} config - Configuration you gave to the transport when constructing {@link centro-js/lib/server.CentroServer|CentroServer}.
 */
/* istanbul ignore next */
exports._authz_start_event = function (cancel, onclose, obj, config) {};

/**
 * Authorization end event. Emitted when a client has been accepted or rejected.
 *
 * @event CentroServer#authz_end
 * @memberof centro-js/lib/server
 * @param {?Object} err - `null` if client was accepted otherwise cause of rejection.
 * @param {{payload: Object, uri: string, rev: rev}[]} [token_infos] - For each authorization token the client presented, its payload, issuer URI and public key revision (see {@link https://github.com/davedoesdev/authorize-jwt|authorize-jwt}).
 * @param {{string}[]} [tokens] - The raw authorization tokens.
 * @param {Object} [obj] - What was authorized. This is either a HTTP request (with a `url` property) or a stream.
 * @param {Object} [config] - Configuration you gave to the transport when constructing {@link centro-js/lib/server.CentroServer|CentroServer}.
 */
/* istanbul ignore next */
exports._authz_end_event = function (err, handshakes, tokens, obj, config) {};

/**
 * Pre-connect event. Emitted after {@link centro-js/lib/server.event:CentroServer#authz_end|authz_end}
 * but before {@link centro-js/lib/server.event:CentroServer#connect|connect}. The client connection
 * has been authorized but handshake data has not yet been received.
 *
 * @event CentroServer#pre_connect
 * @memberof centro-js/lib/server
 * @param {Object} info - Information about the connection.
 * @param {MQlobberServer} info.mqserver - {@link https://github.com/davedoesdev/mqlobber#mqlobberserverfsq-stream-options|MQlobberServer} object managing the connection.
 * @param {AccessControl} info.access_control - {@link https://github.com/davedoesdev/mqlobber-access-control#accesscontroloptions|AccessControl} object enforcing access control on the connection.
 * @param {string} info.connid - Unique ID for the connection.
 * @param {string[]} info.prefixes - For each authorization token the client presented, a prefix which `info.access_control` enforces on topics. The prefix is a hash of the token's issuer ID, thus preventing clients with tokens from different issuers sending and receiving messages to each other. That is, messages are 'scoped' by token issuer.
 * @param {{Object.<string, boolean>}[]} info.subscriptions - A list of topics to which the client is pre-subscribed, along with whether whether existing messages will be delivered to it.
 * @param {centro-js/lib/server.destroyCallback} info.destroy - Call this to close the connection.
 * @param {centro-js/lib/server.oncloseCallback} info.onclose - Call this to register a handler when the connection is closed.
 * @param {{payload: Object, uri: string, rev: rev}[]} info.token_infos - For each authorization token the client presented, its payload, issuer URI and public key revision (see {@link https://github.com/davedoesdev/authorize-jwt|authorize-jwt}).
 */
/* istanbul ignore next */
exports._pre_connect_event = function (info) {};

/**
 * Connect event. Emitted when handshake data has been received on a connection.
 *
 * @event CentroServer#connect
 * @memberof centro-js/lib/server
 * @param {Buffer} hsdata - Handshake received from the client.
 */
/* istanbul ignore next */
exports._connect_event = function (connid, hsdata) {};

/**
 * Disconnect event. Emitted when a client disconnects.
 *
 * @event CentroServer#disconnect
 * @memberof centro-js/lib/server
 * @param {string} connid - Unique ID for the connection.
 */
/* istanbul ignore next */
exports._disconnect_event = function (connid) {};

/**
 * Expired event. Emitted when a token presented by a client expires whilst it
 * is connected. After the event is emitted, the connection is destroyed.
 *
 * @event CentroServer#expired
 * @memberof centro-js/lib/server
 * @param {string} connid - Unique ID for the connection.
 */
/* istanbul ignore next */
exports._expired_event = function (connid) {};

/**
  * Empty event. Emitted when a client disconnects and there are no other
  * clients connected.
  *
  * @event CentroServer#empty
  * @memberof centro-js/lib/server
  */
/* istanbul ignore next */
exports._empty_event = function () {};

/**
 * Close event. Emitted when the server has been closed (see {@link centro-js/lib/server.CentroServer#close|close}).
 *
 * @event CentroServer#close
 * @memberof centro-js/lib/server
 */
/* istanbul ignore next */
exports._close_event = function () {};

/**
 * Error event.
 *
 * @event CentroServer#error
 * @memberof centro-js/lib/server
 * @param {Object} err - The error which occurred.
 * @param {Object} obj - The object which originally raised the error.
 */
/* istanbul ignore next */
exports._error_event = function (err, obj) {};

/**
 * Warning event. If you don't listen to this event then the error is printed
 * to `console.error`.
 *
 * @event CentroServer#warning
 * @memberof centro-js/lib/server
 * @param {Object} err - The non-fatal error which occurred.
 * @param {Object} obj - The object which originally raised the error.
 */
/* istanbul ignore next */
exports._warning_event = function (err, obj) {};
