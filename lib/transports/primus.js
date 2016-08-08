
var Primus = require('primus.io'),
    PrimusDuplex = require('primus-backpressure').PrimusDuplex;

exports.server = function (config, authorize, connected)
{
    var primus = config.primus || primus.createServer(config),
        realm = config.realm || 'centro';

    primus.authorize(function (req, cb)
    {
        authorize(req, function (err, handshakes)
        {
            if (err)
            {
                return cb(err);
            }

            req.handshakes = handshakes;

            cb();
        });
    });

    primus.on('connection', function (spark)
    {
        connected(spark.request.handshakes,
                  new PrimusDuplex(spark, config),
                  function ()
                  {
                      spark.request.socket.destroy();
                  });
    });
};

