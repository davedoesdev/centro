// handle errors on stream (and mqlobber? bpmux? primus-backpressure?)
// need to do anything on stream end?
// if error does it clean up (unsub from fsq)?
// - needs topic for the connection
// Max num of tokens?
// send info in initial handshake?
// timeout so close after user valid
// http post support
// topic for each connection so can reply
// embedded apps?
// in-memory transport?
// multiple transports?
// acks?
// presence?
// everything covered that was in cyberton-server?

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
        required: ['iss', 'sub', 'subscriptions', 'access_control'],
        properties: {
            iss: {
                type: 'string'
            },
            subscriptions: {
                type: 'array',
                items: {
                    type: 'string'
                }
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
            }
        }
    });

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

function CentroServer(config)
{
    EventEmitter.call(this);

    this._realm = config.realm || 'centro';
    this._fsq = config.fsq || new QlobberFSQ(config);

    var ths = this,
        separator = config.separator || '.';

    function error(err)
    {
        ths.emit('error', err, this);
    }

    this._fsq.on('start', function ()
    {
        config.authorize(config, function (err, authz)
        {
            if (err)
            {
                return error(err);
            }

            var connections = new Map(),
                pending_authz = 0,
                changed_uris = new Map();

            authz.on('change', function (uri, rev)
            {
                console.log('uri changed: ', uri, rev);

                var conns = connections.get(uri);

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

            async.eachSeries(config.transports || [config.transport], function (transport, cb)
            {
                transport(config, function (obj, cb)
                {
                    function got_tokens(err, tokens)
                    {
                        if (err)
                        {
                            return cb(ths._make_error(err));
                        }

                        if (typeof tokens === 'string')
                        {
                            tokens = tokens.split(',');
                        }

                        if (tokens.length === 0)
                        {
                            return cb(ths._make_error('no tokens'));
                        }

                        pending_authz += 1;

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
                            pending_authz -= 1;

                            var hs;

                            if (!err)
                            {
                                for (hs of handshakes)
                                {
                                    var new_rev = changed_uris.get(hs.uri);

                                    if ((new_rev !== undefined) &&
                                        (hs.rev !== new_rev))
                                    {
                                        console.log('uri revision has changed: ', hs.uri);
                                        err = 'authority has changed';
                                        break;
                                    }
                                }
                            }

                            if (pending_authz === 0)
                            {
                                changed_uris.clear();
                            }

                            if (err)
                            {
                                return cb(ths._make_error(err));
                            }

                            for (hs of handshakes)
                            {
                                if (!validate(hs.payload))
                                {
                                    return cb(make_error(validate.errorsText));
                                }
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
                    var hs_conns = new Set(),
                        destroyed = false,
                        hs;

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

                    for (hs in handshakes)
                    {
                        var conn = {
                            uri: hs.uri,
                            destroy: dstroy
                        };
                            
                        hs_conns.add(conn);

                        var conns = connections.get(hs.uri);

                        if (conns === undefined)
                        {
                            conns = new Set();
                            connections.set(hs.uri, conns);
                        }

                        conns.add(conn);
                    }

                    onclose(function ()
                    {
                        for (var conn of hs_conns)
                        {
                            var conns = connections.get(conn.uri);

                            if (conns !== undefined)
                            {
                                conns.delete(conn);

                                if (conns.size === 0)
                                {
                                    connections.delete(handshake.uri);
                                }
                            }

                            hs_conns.clear();
                        }
                    });

                    for (hs of handshakes)
                    {
                        // Ensure issuer has no separators
                        hs.prefix = crypto.createHash('sha256')
                                .update(hs.payload.iss)
                                .digest('hex') + separator;
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
                                yield hs.prefix + topic;
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
                    }), mqserver = new MQlobberServer(ths._fsq, stream);

                    mqserver.on('handshake', function (hsdata, delay)
                    {
                        var handshake = delay();

                        async.eachSeries(handshakes, function (hs, cb)
                        {
                            async.eachSeries(hs.payload.subscriptions, function (topic, cb)
                            {
                                mqserver.subscribe(hs.prefix + topic, cb);
                            }, cb);
                        }, function (err)
                        {
                            if (err)
                            {
                                return dstroy(err);
                            }

                            access_control.attach(mqserver);

                            handshake(handshakes.map(function (hs)
                            {
                                return hs.prefix;
                            }));
                        });
                    });
                }, cb, error);
            }, function (err)
            {
                if (err)
                {
                    return error(err);
                }

                ths.emit('ready');
            });
        });
    });
}

CentroServer.prototype._make_error = function (err)
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

    console.warn('authorize error: ', msg);

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

util.inherits(CentroServer, EventEmitter);

exports.CentroServer = CentroServer;
