
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

        authz.on('change', function (uri, rev)
        {
        // what object do we have?
        // or should we call back?

        });

        authz.get_token = function (req, cb)
        {
            this.get_authz_data(req, function (err, info, token)
            {
                if (err)
                {
                    return cb(make_error(err));
                }

                cb(err, token);
            });
        };

        authz._authorize = authz.authorize;
        authz.authorize = function (token, cb)
        {
            this._authorize(token, ['PS256'], function (err, payload, uri, rev)
            {
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




        config.transport(config, authz);


            // authorise the token, close if not authorized
            // we need to monitor for changes too
            // get access control from it
            // - needs topic for the user
            // - prefix issuer
            // - etc
            // timeout so close after user valid
            // run mqlobber on stream


    }
};
