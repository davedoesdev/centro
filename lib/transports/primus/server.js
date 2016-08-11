
var Primus = require('primus.io'),
    PrimusDuplex = require('primus-backpressure').PrimusDuplex;

exports.server = function (config, authorize, connected)
{
    var primus = primus.createServer(config);

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
                      spark.end();
                  },
                  function (cb)
                  {
                      spark.request.socket.on('close', cb);
                  });
    });
};

