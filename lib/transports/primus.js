
var Primus = require('primus.io'),
    PrimusDuplex = require('primus-backpressure').PrimusDuplex;

module.exports = function (config, authz, connected)
{
    var server = config.server || require('http').createServer(),
        primus = new Primus(server, config),
        realm = config.realm || 'centro';

    primus.authorize(function (req, cb)
    {
        authz.get_tokens(req, function (err, tokens)
        {
            if (err)
            {
                return cb(err);
            }

            authz.authorize(tokens, function (err, handshake)
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
        connected(spark.request.handshake,
                  stream: new PrimusDuplex(spark, config),
                  function ()
                  {
                      spark.request.socket.destroy();
                  });
    });
};

