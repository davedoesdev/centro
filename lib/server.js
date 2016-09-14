// timeouts on streams (both ways) and message delivery + fastest-writable
// max publish size?
// should be expose enough in connect event to implement this or build it in?

// handle errors on stream (and mqlobber? bpmux? primus-backpressure?)
// need to do anything on stream end?
// if error does it clean up (unsub from fsq)?
// - needs topic for the connection
// >1 connection over multiple transports
// everything covered that was in cyberton-server?
// check it cleans up connection when closed/cleaned up and times out
// sort out which errors should warn and which should error

"use strict";

var crypto = require('crypto'),
    async = require('async'),
    frame = require('frame-stream'),
    EventEmitter = require('events').EventEmitter,
    util = require('util'),
    QlobberFSQ = require('qlobber-fsq').QlobberFSQ,
    MQlobberServer = require('mqlobber').MQlobberServer,
    AccessControl = require('mqlobber-access-control').AccessControl,
    Ajv = require('ajv'),
    ajv = new Ajv();
    
function compile(required)
{
    return ajv.compile({
        type: 'object',
        required: required,
        properties: {
            iss: {
                type: 'string'
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
                                items: {
                                    type: 'string'
                                }
                            },
                            disallow: {
                                type: 'array',
                                items: {
                                    type: 'string'
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
                                items: {
                                    type: 'string'
                                }
                            },
                            disallow: {
                                type: 'array',
                                items: {
                                    type: 'string'
                                }
                            }
                        }
                    },
                    block: {
                        type: 'array',
                        items: {
                            type: 'string'
                        }
                    }
                }
            },
            ack: {
                type: 'object',
                required: ['prefix'],
                additionalProperties: false,
                properties: {
                    prefix: {
                        type: 'string'
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
                        required: ['prefix'],
                        additionalProperties: false,
                        properties: {
                            prefix: {
                                type: 'string'
                            },
                            data: {}
                        }
                    },
                    disconnect: {
                        type: 'object',
                        required: ['topic'],
                        additionalProperties: false,
                        properties: {
                            topic: {
                                type: 'string'
                            },
                            single: {
                                type: 'boolean',
                            },
                            ttl: {
                                type: 'integer',
                                minimum: 0
                            },
                            data: {}
                        }
                    }
                }
            }
        }
    });
}

var validate = compile(['iss', 'access_control']),
    validate_anon = compile(['access_control']);

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

function CentroServer(config)
{
    EventEmitter.call(this);

    this._realm = config.realm || 'centro';
    this.transport_ops = [];
    this._connections = new Map();
    this._connids = new Set();
    this.fsq = config.fsq || new QlobberFSQ(config);

    var ths = this,
        separator = this.fsq._matcher._separator;

    function error(err)
    {
        /*jshint validthis: true */
        ths.emit('error', err, this);
    }

    function read_frame(s, cb)
    {
        var in_stream = frame.decode(config);

        function done(v)
        {
            if (v)
            {
                throw v;
            }
        }

        s.on('readable', function onread()
        {
            while (true)
            {
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
                    s.removeListener('readable', onread);

                    if (v instanceof Buffer)
                    {
                        var rest = buffer ? Buffer.concat([buffer, data]) : data;
                        s.unshift(rest.slice(in_stream.opts.lengthSize + v.length));
                        return cb(null, v);
                    }

                    cb(v);
                }
            }
        });
    }

    function start()
    {
        config.authorize(config, function (err, authz)
        {
            if (err)
            {
                return error(err);
            }

            var pending_authzs = 0,
                changed_uris = new Map();

            authz.keystore.on('change', function (uri, rev)
            {
                console.log('uri changed:', uri, rev);

                var conns = ths._connections.get(uri);

                if (conns !== undefined)
                {
                    for (var conn of conns)
                    {
                        // Remove while iterating on ES6 Sets is consistent
                        conn.destroy();
                    }
                }

                if (pending_authzs > 0)
                {
                    changed_uris.set(uri, rev);
                }
            });

            var transports = config.transport;

            if (typeof transports[Symbol.iterator] !== 'function')
            {
                transports = [transports];
            }

            async.mapSeries(transports, function (transport, cb)
            {
                function run_transport(config, authz, transport, keystore)
                {
                    transport(config, function (obj, cb)
                    {
                        function got_tokens(err, tokens)
                        {
                            if (err)
                            {
                                return cb(ths._authz_error(err));
                            }

                            if (typeof tokens === 'string')
                            {
                                tokens = tokens.split(',');
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

                            pending_authzs += 1;

                            async.mapSeries(tokens, function (token, cb)
                            {
                                authz.authorize(token, ['PS256'], function (err, payload, uri, rev)
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
                            }, function (err, handshakes)
                            {
                                pending_authzs -= 1;

                                var hs;

                                if (authz.keystore && !err)
                                {
                                    for (hs of handshakes)
                                    {
                                        var new_rev = changed_uris.get(hs.uri);

                                        if ((new_rev !== undefined) &&
                                            (hs.rev !== new_rev))
                                        {
                                            console.log('uri revision has changed:', hs.uri);
                                            err = 'authority has changed';
                                            break;
                                        }
                                    }
                                }

                                if (pending_authzs === 0)
                                {
                                    changed_uris.clear();
                                }

                                if (err)
                                {
                                    return cb(ths._authz_error(err));
                                }

                                var uris = new Set(),
                                    issuers = new Set(),
                                    vdate = authz.keystore ? validate : validate_anon;

                                for (hs of handshakes)
                                {
                                    if (!vdate(hs.payload))
                                    {
                                        return cb(ths._authz_error(ajv.errorsText(validate.errors)));
                                    }

                                    if (!authz.keystore)
                                    {
                                        continue;
                                    }

                                    if (uris.has(hs.uri))
                                    {
                                        return cb(new Error('duplicate URI: ' + hs.uri));
                                    }

                                    if (issuers.has(hs.iss))
                                    {
                                        return cb(new Error('duplicate issuer: ' + hs.iss));
                                    }

                                    uris.add(hs.uri);
                                    issuers.add(hs.payload.iss);
                                }

                                cb(null, handshakes);
                            });
                        }

                        if (obj.url)
                        {
                            authz.get_authz_data(obj, function (err, info, tokens)
                            {
                                got_tokens(err, tokens);
                            });
                        }
                        else
                        {
                            read_frame(obj, function (err, v)
                            {
                                got_tokens(err, err ? undefined : v.toString());
                            });
                        }
                    }, function (handshakes, stream, destroy, onclose)
                    {
                        var connid,
                            hs_conns = new Set(),
                            destroyed = false,
                            hs;

                        do
                        {
                            connid = crypto.randomBytes(32).toString('hex');
                        }
                        while (ths._connids.has(connid));

                        function replace(topic)
                        {
                            return topic.split('${self}').join(connid);
                        }

                        ths._connids.add(connid);

                        function dstroy()
                        {
                            if (!destroyed)
                            {
                                try
                                {
                                    destroy();
                                }
                                catch (ex)
                                {
                                    error(ex);
                                }

                                destroyed = true;
                            }
                        }

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

                        for (hs of handshakes)
                        {
                            var conn = {
                                destroy: dstroy
                            };
                                
                            hs_conns.add(conn);

                            schedule(hs.payload.exp * 1000, 
                                     make_update(conn),
                                     make_destroy(conn));
                            
                            if (!authz.keystore)
                            {
                                continue;
                            }

                            conn.uri = hs.uri;

                            var conns = ths._connections.get(hs.uri);

                            if (conns === undefined)
                            {
                                conns = new Set();
                                ths._connections.set(hs.uri, conns);
                            }

                            conns.add(conn);
                        }

                        var mqserver, presence = new Map();

                        onclose(function ()
                        {
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

                                if (conns !== undefined)
                                {
                                    conns.delete(conn);

                                    if (conns.size === 0)
                                    {
                                        ths._connections.delete(conn.uri);
                                    }
                                }
                            }

                            hs_conns.clear();

                            ths._connids.delete(connid);

                            if (mqserver)
                            {
                                ths.emit('disconnect', mqserver);

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
                                                options.single ? mqserver.fsq._single_ttl : mqserver.fsq._multi_ttl,
                                                p.disconnect.ttl * 1000);
                                    }

                                    var s = mqserver.fsq.publish(prefix + replace(p.disconnect.topic), options);

                                    if (p.disconnect.data !== undefined)
                                    {
                                        s.write(JSON.stringify(p.disconnect.data));
                                    }

                                    s.end();
                                }
                            }

                            if (ths._connections.size === 0)
                            {
                                ths.emit('empty');
                            }
                        });

                        var ack_prefixes = new Map();

                        for (hs of handshakes)
                        {
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
                        }

                        function AggregateTopics(action, type)
                        {
                            this.action = action;
                            this.type = type;
                        }

                        AggregateTopics.prototype[Symbol.iterator] = function* ()
                        {
                            for (hs of handshakes)
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
                                disallow: new AggregateTopics('publish', 'disallow')
                            },
                            subscribe: {
                                allow: new AggregateTopics('subscribe', 'allow'),
                                disallow: new AggregateTopics('subscribe', 'disallow')
                            },
                            block: new AggregateTopics('block')
                        });

                        if (presence.size > 0)
                        {
                            access_control.on('publish_requested',
                            function (server, topic, stream, options, cb)
                            {
                                var pos = 0, prefix = '';

                                if (authz.keystore)
                                {
                                    pos = topic.indexOf(separator);

                                    if (pos >= 0)
                                    {
                                        prefix = topic.substr(0, pos);
                                    }
                                }

                                var p = presence.get(prefix);

                                if (p !== undefined)
                                {
                                    var pprefix = p.connect.prefix;

                                    if (authz.keystore)
                                    {
                                        prefix += separator;
                                    }

                                    if (topic.lastIndexOf(prefix + replace(pprefix), 0) === 0)
                                    {
                                        var s = server.fsq.publish(topic, options, cb);
                                        if (p.connect.data !== undefined)
                                        {
                                            s.write(JSON.stringify(p.connect.data));
                                        }

                                        return s.end();
                                    }
                                }

                                stream.pipe(server.fsq.publish(topic, options, cb));
                            });
                        }

                        mqserver = new MQlobberServer(ths.fsq, stream);
                        access_control.attach(mqserver);

                        if (ack_prefixes.size > 0)
                        {
                            mqserver.on('ack', function (info)
                            {
                                var pos = 0, prefix = '';

                                if (authz.keystore)
                                {
                                    pos = info.topic.indexOf(separator);

                                    if (pos >= 0)
                                    {
                                        prefix = info.topic.substr(0, pos);
                                        pos += 1;
                                    }
                                }

                                var ack_prefix = ack_prefixes.get(prefix);

                                if (ack_prefix !== undefined)
                                {
                                    if (authz.keystore)
                                    {
                                        prefix += separator;
                                    }

                                    ths.fsq.publish(prefix +
                                                    replace(ack_prefix) +
                                                    info.topic.substr(pos))
                                           .end();
                                }
                            });
                        }

                        mqserver.on('handshake', function (hsdata, delay)
                        {
                            var prefixes = handshakes.map(function (hs)
                            {
                                return hs.prefix;
                            });

                            delay()(new Buffer(JSON.stringify(
                            {
                                self: connid,
                                prefixes: prefixes
                            })));

                            ths.emit('connect',
                            {
                                mqserver: this,
                                access_control: access_control,
                                connid: connid,
                                prefixes: prefixes,
                                hsdata: hsdata
                            });
                        });
                    },
                    function (err, ops)
                    {
                        if (err)
                        {
                            if (keystore)
                            {
                                return keystore.close(function (err2)
                                {
                                    if (err2)
                                    {
                                        error(err2);
                                    }

                                    cb(err);
                                });
                            }

                            return cb(err);
                        }

                        if (!keystore)
                        {
                            return cb(null, ops);
                        }

                        var close = ops.close;
                        ops.close = function (cb)
                        {
                            authz.keystore.close(function (err2)
                            {
                                if (!err2)
                                {
                                    return close(cb);
                                }

                                close(function (err3)
                                {
                                    if (err3)
                                    {
                                        error(err2);
                                        return cb(err3);
                                    }

                                    cb(err2);
                                });
                            });
                        };
                    },
                    error);
                }

                if (typeof transport === 'function')
                {
                    run_transport(config, authz, transport);
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
                                return cb(err);
                            }

                            run_transport(tconfig, authz, transport.server, authz.keystore);
                        });
                    }
                    else
                    {
                        run_transport(tconfig, authz, transport.server, null);
                    }
                }
            }, function (err, transport_ops)
            {
                if (err)
                {
                    return error(err);
                }

                ths.transport_ops = transport_ops;
                ths.authz = authz;

                process.nextTick(function ()
                {
                    ths.emit('ready');
                });
            });
        });
    }

    if (this.fsq.initialized)
    {
        process.nextTick(start);
    }
    else
    {
        this.fsq.on('start', start);
    }
}

util.inherits(CentroServer, EventEmitter);

CentroServer.prototype.close = function (cb)
{
    var ths = this;

    cb = cb || function () {};

    function close_transports(err)
    {
        if (err)
        {
            return cb(err);
        }

        var transport_ops = ths.transport_ops;
        ths.transport_ops = [];

        async.each(transport_ops, function (ops, cb)
        {
            ops.close(cb);
        }, function (err)
        {
            if (err)
            {
                return cb(err);
            }

            if (ths._connections.size === 0)
            {
                return cb();
            }

            ths.on('empty', function ()
            {
                this.emit('close'); 
                cb();
            });

            for (var conns of ths._connections.values())
            {
                for (var conn of conns)
                {
                    // Remove while iterating on ES6 Sets is consistent
                    conn.destroy();
                }
            }
        });
    }

    if (!this.authz.keystore)
    {
        return close_transports();
    }

    this.authz.keystore.close(close_transports);
};

CentroServer.prototype._authz_error = function (err)
{
    var msg;

    if (err.message !== undefined)
    {
        msg = err.message;
    }
    else if (err.error !== undefined)
    {
        msg = err.error + " (" + err.reason + ")";
    }
    else
    {
        msg = String(err);
    }

    console.warn('authorize error:', msg);

    if (!err.statusCode)
    {
        if (typeof err === 'string')
        {
            err = {
                statusCode: 401,
                authenticate: 'Basic realm="' + this._realm + '"',
                message: msg
            };
        }
        else
        {
            err = {
                statusCode: 500,
                message: msg
            };
        }
    }

    return err;
};

exports.CentroServer = CentroServer;
