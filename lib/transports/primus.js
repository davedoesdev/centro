
var Primus = require('primus'),
    PrimusDuplex = require('primus-backpressure').PrimusDuplex;

module.exports = function (config, authorize, connected, ready, error, warning)
{
    config = config.primus || config;

    var options = Object.assign({}, config, { transport: undefined }),
        primus = config.primus ||
                 (config.server ? new Primus(config.server, options) :
                                  Primus.createServer(options));

    primus.authorize(function (req, cb)
    {
        authorize(req, function ()
        {
            cb({ statusCode: 503, message: 'closed' });
        }, function (err, handshakes)
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

    primus.on('error', error);

    function initialised()
    {
        ready(null,
        {
            close: function (cb)
            {
                primus.destroy(config, cb);
            },

            server: this.server
        });
    }

    function listening()
    {
        if (primus.transformer)
        {
            initialised();
        }
        else
        {
            primus.on('initialised', initialised);
        }
    }

    if (primus.server.listening === false)
    {
        primus.server.once('listening', listening);
    }
    else
    {
        listening();
    }
};

