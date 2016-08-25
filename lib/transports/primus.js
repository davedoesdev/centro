
var Primus = require('primus'),
    PrimusDuplex = require('primus-backpressure').PrimusDuplex;

exports.server = function (config, authorize, connected, ready, error)
{
    var primus = Primus.createServer(Object.assign({},
                                                   config,
                                                   { transport: undefined }));

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
                  new PrimusDuplex(spark, Object.assign(
                  {
                      allowHalfOpen: false
                  }, config)),
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

    primus.on('initialised', function ()
    {
        ready(null, function (cb)
        {
            primus.destroy(cb);
        });
    });

    primus.on('error', error);
};

