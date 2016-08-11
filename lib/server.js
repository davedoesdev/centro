
var crypto = require('crypto'),
    QlobberFSQ = require('qlobber-fsq').QlobberFSQ,
    MQlobberServer = require('mqlobber').MQlobberServer,
    AccessControl = require('mqlobber-access-control').AccessControl,
    frame = require('frame-stream'),
    Ajv = require('ajv'),
    ajv = new Ajv(),
    validate = ajv.compile({
        type: 'object',
        required: ['iss', 'sub', 'subscriptions', 'access_control'],
        properties: {
            iss: {
                type: 'string'
            },
            sub: {
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
                required: ['publish', 'subscribe']
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

function check_error(err)
{
    if (err)
    {
        throw err;
    }
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

function make_error(err, realm)
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
                authenticate: 'Basic realm="' + realm + '"',
                message: msg
            }
        }
        else
        {
            err = {
                statusCode: 500,
                message: msg
            }
        }
    }

    return err;
}

module.exports = function (config)
{
    var realm = config.realm || 'centro',
        fsq = new QlobberFSQ(config),
        separator = fsq._matcher._separator;

    fsq.on('start', function ()
    {
        config.authorize(config, function (err, authz)
        {
            check_error(err);

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
                        try
                        {
                            // Remove while iterating on ES6 Sets is consistent
                            conn.destroy();
                        }
                        catch (ex)
                        {
                            console.error(ex);
                        }
                    }
                }

                if (pending_authzs > 0)
                {
                    changed_uris.set(uri, rev);
                }
            });

            config.transport(config, function (obj, cb)
            {
                function got_tokens(err, tokens)
                {
                    if (err)
                    {
                        return cb(make_error(err, realm));
                    }

                    if (typeof tokens === 'string')
                    {
                        tokens = [tokens];
                    }

                    pending_authz += 1;

                    // TODO: Max num of tokens?

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

                        })
                    }, function (err, handshakes)
                    {
                        pending_authz -= 1;

                        if (!err)
                        {
                            for (var hs of handshakes)
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
                            return cb(make_error(err, realm));
                        }

                        for (var hs of handshakes)
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
                        got_tokens(err, err ? undefined : v.toString().split(','));
                    });
                }
            }, function (handshakes, stream, destroy, onclose)
            {
                var hs_conns = new Set(),
                    destroyed = false;

                function dstroy()
                {
                    if (!destroyed)
                    {
                        destroy();
                        destroyed = true;
                    }
                }

                for (var hs in handshakes)
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

                var mqserver = new MQlobberServer(fsq, stream);

                for (var hs of handshakes)
                {
                    // Ensure issuer has no separators
                    hs.prefix = crypto.createHash('sha256')
                            .update(hs.payload.iss)
                            .digest('hex') + separator;

                    for (var topic of hs.payload.subscriptions)
                    {
                        mqserver.subscribe(hs.prefix + topic);
                    }
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
                        for (var topic of hs.payload.access_control[this.action][this.type])
                        {
                            yield hs.prefix + topic;
                        }
                    }
                };

                new AccessControl(
                    publish: {
                        allow: new AggregateTopics('publish', 'allow'),
                        disallow: new AggregateTopics('publish', 'disallow')
                    },
                    subscribe: {
                        allow: new AggregateTopics('subscribe', 'allow'),
                        disallow: new AggregateTopics('subscribe', 'disallow')
                    }
                ).attach(mqserver);
            });

                // handle errors on stream (and mqlobber? bpmux? primus-backpressure?)
                // need to do anything on stream end?
                // if error does it clean up (unsub from fsq)?
                // - needs topic for the connection
                // send info in initial handshake?
                // timeout so close after user valid
                // run mqlobber on stream
                // http post support
                // topic for each connection so can reply
                // embedded apps?
                // in-memory transport?
                // multiple transports?
                // acks?
                // presence?


        });
    });
};
