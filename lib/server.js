

var crypto = require('crypto');

/*takes config
passes fn to config.transport
fn takes stream; may need to take close fn and other stuff too*/

function check_error(err)
{
    if (err)
    {
        throw err;
    }
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
                for (var [id, conn] of conns)
                {
                    try
                    {
                        console.log('booting ', id);
                        conn.destroy();
                    }
                    catch (ex)
                    {
                        console.error(ex);
                    }
                }

                connections.delete(uri);
            }

            if (pending_authzs > 0)
            {
                changed_uris.set(uri, rev);
            }
        });

        authz.get_tokens = function (req, cb)
        {
            this.get_authz_data(req, function (err, info, tokens)
            {
                if (err)
                {
                    return cb(make_error(err));
                }

                if (typeof tokens === 'string')
                {
                    tokens = [tokens];
                }

                cb(err, tokens);
            });
       };

        authz._authorize = authz.authorize;
        authz.authorize = function (tokens, cb)
        {
            pending_authz += 1;

            // token can be an array of tokens
            // do we have a single connection ID per token?
            // max num of tokens?

            this._authorize(token, ['PS256'], function (err, payload, uri, rev)
            {
                pending_authz -= 1;

                if (!err)
                {
                    var new_rev = changed_uris.get(uri);

                    if ((new_rev !== undefined) && (rev !== new_rev))
                    {
                        console.log('uri revision has changed: ', uri);
                        err = 'authority has changed';
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

                if (!has_string_props(payload, cb, 'iss', 'sub'))
                {
                    return;
                }

                cb(null,
                {
                    payload: payload,
                    uri: uri,
                    rev: rev
                });
            });
        };

/*optional:

subscriptions

access-control
  publish
    allow
    disallow
  subscribe
    allow
    disallow*/



        config.transport(config, authz, function (handshake, stream, destroy)
        {
            var id = crypto.randomBytes(32).toString('hex'),
                conns = connections.get(handshake.uri);

            if (conns === undefined)
            {
                conns = new Map();
                connections.set(handshake.uri, conns);
            }

            conns.set(id, 
            {
                destroy: destroy
            });

            stream.on('end', function ()
            {
                var conns = connections.get(handshake.uri);

                if (conns !== undefined)
                {
                    conns.delete(id);

                    if (conns.size === 0)
                    {
                        connections.delete(handshake.uri);
                    }
                }
            });

        });


            // get access control from it
            // - needs topic for the user
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
