// http post support
// embedded apps?
// in-memory transport?
// presence?
// anonymous mode
// pub data to send in presence (joined) event - receiver knows it was signed
// timeouts on streams and message delivery + fastest-writable

// handle errors on stream (and mqlobber? bpmux? primus-backpressure?)
// need to do anything on stream end?
// if error does it clean up (unsub from fsq)?
// - needs topic for the connection
// >1 connection
// everything covered that was in cyberton-server?
// check it cleans up connection when closed/cleaned up and times out

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
    ajv = new Ajv(),
    validate = ajv.compile({
        type: 'object',
        required: ['iss', 'access_control'],
        properties: {
            iss: {
                type: 'string'
            },
            access_control: {
                type: 'object',
                required: ['publish', 'subscribe'],
                properties: {
                    publish: {
                        type: 'object',
                        required: ['allow', 'disallow'],
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
                    }
                }
            },
            ack: {
                type: 'object',
                required: ['prefix'],
                properties: {
                    prefix: {
                        type: 'string'
                    }
                }
            }
        }
    });

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
    this._closes = [];
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

            if (typeof transports === 'function')
            {
                transports = [transports];
            }

            async.mapSeries(transports, function (transport, cb)
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

                        if (config.max_tokens && (tokens.length > config.max_tokens))
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

                            if (!err)
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
                                issuers = new Set();

                            for (hs of handshakes)
                            {
                                if (!validate(hs.payload))
                                {
                                    return cb(ths._authz_error(ajv.errorsText(validate.errors)));
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

                    function dstroy(err)
                    {
                        if (err)
                        {
                            error(err);
                        }

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

                    for (hs of handshakes)
                    {
                        var conn = {
                            uri: hs.uri,
                            destroy: dstroy
                        };
                            
                        hs_conns.add(conn);

                        var conns = ths._connections.get(hs.uri);

                        if (conns === undefined)
                        {
                            conns = new Set();
                            ths._connections.set(hs.uri, conns);
                        }

                        conns.add(conn);

                        schedule(hs.payload.exp * 1000, function (timeout)
                        {
                            conn.timeout = timeout;
                        }, function ()
                        {
                            conn.timeout = null;
                            dstroy();
                        });
                    }

                    onclose(function ()
                    {
                        for (var conn of hs_conns)
                        {
                            var conns = ths._connections.get(conn.uri);

                            if (conns !== undefined)
                            {
                                conns.delete(conn);

                                if (conns.size === 0)
                                {
                                    ths._connections.delete(conn.uri);
                                }
                            }

                            if (conn.timeout)
                            {
                                clearTimeout(conn.timeout);
                            }
                        }

                        hs_conns.clear();

                        ths._connids.delete(connid);

                        if (ths._connections.size === 0)
                        {
                            ths.emit('empty');
                        }
                    });

                    var ack_prefixes = new Map();

                    for (hs of handshakes)
                    {
                        // Ensure issuer has no separators
                        hs.prefix = crypto.createHash('sha256')
                                .update(hs.payload.iss)
                                .digest('hex');

                        if (hs.payload.ack)
                        {
                            ack_prefixes.set(hs.prefix, hs.payload.ack.prefix);
                        }

                        hs.prefix += separator;
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
                            for (var topic of hs.payload.access_control[this.action][this.type])
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
                        }
                    }), mqserver = new MQlobberServer(ths.fsq, stream);

                    if (ack_prefixes.size > 0)
                    {
                        mqserver.on('ack', function (info)
                        {
                            var pos = info.topic.indexOf(separator);

                            if (pos >= 0)
                            {
                                var prefix = info.topic.substr(0, pos),
                                    ack_prefix = ack_prefixes.get(prefix);

                                if (ack_prefix !== undefined)
                                {
                                    ths.fsq.publish(prefix + separator + replace(ack_prefix) + info.topic.substr(pos)).end();
                                }

                            }
                        });
                    }

                    mqserver.on('handshake', function (hsdata, delay)
                    {
                        access_control.attach(mqserver);

                        delay()(new Buffer(JSON.stringify(
                        {
                            self: connid,
                            prefixes: handshakes.map(function (hs)
                            {
                                return hs.prefix;
                            })
                        })));
                    });
                }, cb, error);
            }, function (err, closes)
            {
                if (err)
                {
                    return error(err);
                }

                ths._closes = closes;
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
        start();
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

    this.authz.keystore.close(function (err)
    {
        if (err)
        {
            return cb(err);
        }

        var closes = ths._closes;
        ths._closes = [];

        async.each(closes, function (close, cb)
        {
            close(cb);
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
    });
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
