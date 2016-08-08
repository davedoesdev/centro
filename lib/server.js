
var crypto = require('crypto'),
    frame = require('frame-stream'),
    algs = ['PS256'];

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

module.exports = function (config)
{
    function make_error(err)
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
                    authenticate: 'Basic realm="' +
                                  (config.realm || 'centro') +
                                  '"',
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

    function has_string_props(payload, cb)
    {
        if (!payload)
        {
            cb('empty payload');
            return false;
        }

        for (var i = 2; i < arguments.length; i += 1)
        {
            var prop = arguments[i];

            if (obj[prop] === undefined)
            {
                cb('missing payload property: ', prop);
                return false;
            }

            if (typeof obj[prop] !== 'string')
            {
                cb('payload property must be a string: ' , prop);
                return false;
            }
        }

        return true;
    }

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
                    return cb(make_error(err));
                }

                if (typeof tokens === 'string')
                {
                    tokens = [tokens];
                }

                pending_authz += 1;

                // TODO: Max num of tokens?

                async.mapSeries(tokens, function (token, cb)
                {
                    authz.authorize(token, algs, function (err, payload, uri, rev)
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
                        return cb(make_error(err));
                    }

                    for (var hs of handshakes)
                    {
                        if (!has_string_props(hs.payload, cb, 'iss', 'sub'))
                        {
                            return;
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
        }, function (handshakes, stream, destroy)
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

            var ended = false,
                finished = false;

            function check_done()
            {
                if (!ended || !finished)
                {
                    return;
                }

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
                }
            }

            stream.on('end', function ()
            {
                ended = true;
                check_done();
            });

            stream.on('finish', function ()
            {
                finished = true;
                check_done();
            });
        });

/*optional:

subscriptions

access-control
  publish
    allow
    disallow
  subscribe
    allow
    disallow*/

            // get access control from it
            // - needs topic for the connection
            // - prefix issuer (actually hash of iss)
            // - etc
            // send info in initial handshake?
            // timeout so close after user valid
            // run mqlobber on stream
            // http post support
            // topic for each connection so can reply
            // embedded apps?
            // in-memory transport?
            // multiple transports?
            // acks?


    }
};
