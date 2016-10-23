
var Primus = require('primus'),
    PrimusDuplex = require('primus-backpressure').PrimusDuplex;

module.exports = function (config, authorize, connected, ready, error, warning)
{
    config = config.primus || config;

    var server = config.server || Primus.createServer(
                        Object.assign({}, config, { transport: undefined }));

    server.authorize(function (req, cb)
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

    function connection(spark)
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
                      if (spark.request.socket.destroyed)
                      {
                          return cb();
                      }
                      spark.request.socket.on('close', cb);
                  });
    }

    server.on('connection', connection);
    server.on('error', error);

    function initialised()
    {
        ready(null,
        {
            close: function (cb)
            {
                server.auth = null;
                server.removeListener('connection', connection);
                server.removeListener('error', error);

                if (config.server)
                {
                    return cb();
                }

                server.destroy(config, cb);
            },

            server: this.server
        });
    }

    if (config.server)
    {
        return initialised();
    }

    server.on('initialised', initialised);
};

