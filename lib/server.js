// TODO:
// test for empty allowed_algs and wrong alg? for all configs?
// config should have some defaults for max values like frame maxSize, max header size etc? or at least list everything which can be set - inc where have done tests to do using events/hooks etc; just point to tests or put all this in some config module?

/*
ignore these, they'd have to be defined in transport config or config.mqlobber:
  - max_write_size (primus-backpressure, bpmux)
  - check_read_overflow (primus-backpressure, bpmux)
  - highWaterMark (primus-backpressure, bpmux, transports/in-mem)

duplicates:
  - max_topic_length (mqlobber-access-control, centro server, centro client)
  - max_subscriptions (mqlobber-access-control, centro client)

primus-backpressure (c+s):
  - max_write_size (max bytes to write onto conn at once. 0, no max)
  - check_read_overflow (check if more data than expected, true)
  - highWaterMark (amount of data buffered, 16k)

frame-stream (c+s):
  - maxSize (max alowed msg size. 0, no max)

bpmux (c+s):
  - peer_multiplex_options
    - max_write_size (max bytes to write to the Duplex at once. 0, no max)
    - check_read_overflow (check if more data than expected, true)
    - highWaterMark (amount of data buffered, 16k)
  - coalesce_writes (batch writes to carrier, false)
  - max_open (max num multiplexed streams at a time. 0, no max)
  - max_header_size (max header bytes. 0, no limit)
  - max_write_size
  - check_read_overflow
  - highWaterMark
  - full event?

mqlobber:
  - send_expires (send message expiry. false)
  - send_size (send message size. false)
  - message event
  - backoff event
  - extra data arg to done in _requested events
  - test: custom data on message info and stream; fastest-writable
  - test: delay message until all streams under hwm
  - test: existing messages

mqlobber-access-control:
  - max_publish_data_length Max bytes in published message
  - max_subscriptions Max num topics to which MQlobberServer objects can be
    subscribed at any one time
  - max_topic_length Max topic length for pub, sub, unsub

authorize-jwt:
  - jwt_audience_uri
  - jwt_max_token_expiry
  - ANONYMOUS_MODE

pub-keystore:
  - db_type
  - db_name
  - db_already_created
  - no_changes
  - silent
  - db_for_update
  - deploy_name
  - db_dir
  - no_initial_replicate
  - keep_master_open
  - persistent_watch
  - replicate_signal
  - db_host
  - db_port
  - ca
  - username
  - password
  - maxSockets

node-jsjws:
  - iat_skew Leeway (s) for JWT auth
  - checks_optional Whether token must contain typ, iat, nbf and exp

qlobber-fsq:
  - fsq_dir
  - encode_topics
  - split_topic_at
  - bucket_base
  - bucket_stamp_size
  - flags
  - unique_bytes
  - single_ttl
  - multi_ttl
  - poll_interval
  - notify
  - retry_interval
  - message_concurrency
  - bucket_concurrency
  - handler_concurrency
  - order_by_expiry
  - dedup
  - single
  - separator
  - wildcard_one
  - wildcard_some
  - filter

centro server:
  - authorize
  - max_topic_length
  - max_issuer_length
  - max_allow_publish_topics
  - max_disallow_publish_topics
  - max_allow_subscribe_topics
  - max_disallow_subscribe_topics
  - max_block_topics
  - max_subscribe_topics
  - max_presence_data_length
  - realm
  - fsq
  - transport (each transport can have its own config too)
  - max_tokens
  - max_token_length
  - allowed_algs
  - mqlobber

centro client:
  - token
  - max_topic_length
  - max_subscriptions

transports/http:
  - key
  - cert
  - port
  - server
  - pathname
  - access
  - sse_keep_alive_interval
  + tls.createServer
  + access-control

transports/in-mem:
  - highWaterMark

transports/primus:
  - server
  + primus
  + primus-backpressure

transports/tcp:
  - server
  + net.createServer
  + net.server.listen

tests:
  - throttle publish stream
  - throttle message stream
  - time-out publish stream
  - time-out message stream
  - limit data published per message
  - limit data published per connection
  - limit number of messages published per connection
  - limit number of subscriptions across all connections
  - authz_start and authz_end events
  - cancel authorization
  - http cancel publish/subscribe authorization
  - count active connections
  - limit number of active connections
  - delay message until all streams are under high-water mark
  - fastest-writable (drop destinations which can't keep up)
  - maxConnections
  - http publish request timeout
*/


// docs!

"use strict";

var crypto = require('crypto'),
    path = require('path'),
    async = require('async'),
    frame = require('frame-stream'),
    authorize_jwt = require('authorize-jwt'),
    EventEmitter = require('events').EventEmitter,
    util = require('util'),
    QlobberFSQ = require('qlobber-fsq').QlobberFSQ,
    MQlobberServer = require('mqlobber').MQlobberServer,
    AccessControl = require('mqlobber-access-control').AccessControl,
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
        while (true)
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

function CentroServer(config)
{
    EventEmitter.call(this);

    config = Object.assign(
    {
        authorize: authorize_jwt,
        db_type: 'pouchdb',
        transport: []
    }, config);

    var sub_additional_properties,
        sub_pattern_properties;

    if (config.max_topic_length === undefined)
    {
        sub_additional_properties = { type: 'boolean' };
    }
    else
    {
        sub_additional_properties = false;
        sub_pattern_properties = {};
        sub_pattern_properties["^.{0," + config.max_topic_length + "}$"] =
                { type: 'boolean' };
    }

    function compile(required)
    {
        return ajv.compile({
            type: 'object',
            required: required,
            properties: {
                exp: {
                    type: 'integer'
                },
                iss: {
                    type: 'string',
                    maxLength: config.max_issuer_length
                },
                access_control: {
                    type: 'object',
                    required: ['publish', 'subscribe'],
                    additionalProperties: false,
                    properties: {
                        publish: {
                            type: 'object',
                            required: ['allow', 'disallow'],
                            additionalProperties: false,
                            properties: {
                                allow: {
                                    type: 'array',
                                    maxItems: config.max_allow_publish_topics,
                                    items: {
                                        type: 'string',
                                        maxLength: config.max_topic_length
                                    }
                                },
                                disallow: {
                                    type: 'array',
                                    maxItems: config.max_disallow_publish_topics,
                                    items: {
                                        type: 'string',
                                        maxLength: config.max_topic_length
                                    }
                                }
                            }
                        },
                        subscribe: {
                            type: 'object',
                            required: ['allow', 'disallow'],
                            additionalProperties: false,
                            properties: {
                                allow: {
                                    type: 'array',
                                    maxItems: config.max_allow_subscribe_topics,
                                    items: {
                                        type: 'string',
                                        maxLength: config.max_topic_length
                                    }
                                },
                                disallow: {
                                    type: 'array',
                                    maxItems: config.max_disallow_subscribe_topics,
                                    items: {
                                        type: 'string',
                                        maxLength: config.max_topic_length
                                    }
                                }
                            }
                        },
                        block: {
                            type: 'array',
                            maxItems: config.max_block_topics,
                            items: {
                                type: 'string',
                                maxLength: config.max_topic_length
                            }
                        }
                    }
                },
                subscribe: {
                    type: 'object',
                    maxProperties: config.max_subscribe_topics,
                    additionalProperties: sub_additional_properties,
                    patternProperties: sub_pattern_properties
                },
                ack: {
                    type: 'object',
                    required: ['prefix'],
                    additionalProperties: false,
                    properties: {
                        prefix: {
                            type: 'string',
                            maxLength: config.max_topic_length
                        }
                    }
                },
                presence: {
                    type: 'object',
                    required: ['connect', 'disconnect'],
                    additionalProperties: false,
                    properties: {
                        connect: {
                            type: 'object',
                            required: ['topic'],
                            additionalProperties: false,
                            properties: {
                                topic: {
                                    type: 'string',
                                    maxLength: config.max_topic_length
                                },
                                single: {
                                    type: 'boolean'
                                },
                                ttl: {
                                    type: 'integer',
                                    minimum: 0
                                },
                                data: {
                                    type: 'string',
                                    maxLength: config.max_presence_data_length
                                }
                            }
                        },
                        disconnect: {
                            type: 'object',
                            required: ['topic'],
                            additionalProperties: false,
                            properties: {
                                topic: {
                                    type: 'string',
                                    maxLength: config.max_topic_length
                                },
                                single: {
                                    type: 'boolean'
                                },
                                ttl: {
                                    type: 'integer',
                                    minimum: 0
                                },
                                data: {
                                    type: 'string',
                                    maxLength: config.max_presence_data_length
                                }
                            }
                        }
                    }
                }
            }
        });
    }

    var validate = compile(['iss', 'access_control']),
        validate_anon = compile(['access_control']);

    this._realm = config.realm || 'centro';
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
        ths.emit('error', err, this);
    }
    this._error = error;

    function warning(err)
    {
        /*jshint validthis: true */
        if (err && !ths.emit('warning', err, this))
        {
            console.error(err);
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
        if (err)
        {
            return error(err);
        }

        if (default_authz.keystore)
        {
            default_authz.keystore.on('change', change);
        }

        var transports = config.transport;

        if (typeof transports[Symbol.iterator] !== 'function')
        {
            transports = [transports];
        }

        function run_transport(config, authz, transport, keystore_to_close, next)
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
                            for (let buf of bufs)
                            {
                                obj.write(buf);
                            }
                        };
                        out_stream.end(buf);
                    }

                    if (!authz_ended)
                    {
                        ths.emit('authz_end', err, handshakes, tokens, obj, config, transport);
                        authz_ended = true;
                    }

                    if (ths._pending_authz_destroys.delete(destroy))
                    {
                        cb2(err, handshakes, tokens);
                    }
                }

                function got_tokens(err, tokens)
                {
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
                }, onclose, obj, config, transport);

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
                    info,
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

                    if (info)
                    {
                        ths.emit('disconnect', info);

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

                    schedule(hs.payload.exp * 1000, 
                             make_update(conn),
                             make_destroy(conn));
                    
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

                    var access_control = new AccessControl(
                    {
                        publish: {
                            allow: new AggregateTopics('publish', 'allow'),
                            disallow: new AggregateTopics('publish', 'disallow'),
                            max_data_length: config.max_publish_data_length
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

                    info = {
                        mqserver: mqserver,
                        access_control: access_control,
                        connid: connid,
                        prefixes: prefixes,
                        subscriptions: subscriptions,
                        destroy: dstroy,
                        onclose: onclose
                    };

                    ths.emit('pre_connect', info);

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

                        info.hsdata = hsdata.slice(4);
                        ths.emit('connect', info);

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
                run_transport(config, default_authz, transport, null, next);
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

                        run_transport(tconfig, authz, transport.server, authz.keystore, next);
                    });
                }
                else
                {
                    run_transport(tconfig, default_authz, transport.server, null, next);
                }
            }
        }

        function start_transport(transport, next)
        {
            if (!ths.fsq)
            {
                ths.fsq = config.fsq || new QlobberFSQ(config);
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
            if (err)
            {
                return error(err);
            }

            ths.transport_ops = transport_ops;
            ths.authz = default_authz;

            process.nextTick(function ()
            {
                ths._ready = true;

                if (ths._close_cb)
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
        config.authorize(config, authorize);
    });
}

util.inherits(CentroServer, EventEmitter);

CentroServer.prototype._close = function (cb)
{
    var ths = this;

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

        function cont()
        {
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
                ops.close(cb);
            }), function (err)
            {
                function cont2()
                {
                    closed = true;
                    check();
                }

                if (err)
                {
                    var cb2 = cb;
                    cb = function () {};
                    return cb2(err, cont2);
                }

                cont2();
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
            var cb2 = cb;
            cb = function () {};
            return cb2(err, cont);
        }

        cont();
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
        this.fsq.removeListener('warning', this._warning);
        this.fsq.removeListener('error', this._error);

        if (!this._config.fsq)
        {
            return this.fsq.stop_watching(close_keystore);
        }
    }

    close_keystore();
};

CentroServer.prototype.close = function (cb)
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

CentroServer.prototype._authz_error = function (err)
{
    if (!err.message)
    {
        err = new Error(String(err));
    }

    this._warning(err);

    return {
        statusCode: 401,
        authenticate: 'Basic realm="' + this._realm + '"',
        message: err.message
    };
};

CentroServer.load_transport = function (name)
{
    return require('.' + path.sep + path.join('transports', name));
};

exports.read_frame = read_frame;
exports.CentroServer = CentroServer;
