
var Primus = require('primus.io');

module.exports = function (config, authz, connected)
{
    var server = config.server || require('http').createServer(),
        primus = new Primus(server, config),
        realm = config.realm || 'centro';

    primus.authorize(function (req, cb)
    {
        authz.get_token(req, function (err, token)
        {
            if (err)
            {
                return cb(err);
            }

            authz.authorize(token, function (err, handshake)
            {
                if (err)
                {
                    rerturn cb(err);
                }

                req.handshake = handshake;
                cb();
            });
        });
    });

    primus.on('connection', function (spark)
    {
        connected(
        {
            handshake: spark.request.handshake,
            stream: use primus-backpressure to get stream,
            close: destroy request socket
        });
    });
};

