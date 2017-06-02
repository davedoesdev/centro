
var centro = require('../..'),
    Primus = require('primus'),
    PrimusDuplex = require('primus-backpressure').PrimusDuplex;

module.exports = function (config, authorize, connected, ready, error, warning)
{
    config = config.primus || config;

    var server = config.server || Primus.createServer(
                        Object.assign(
                        {
                            pathname: '/centro/v' + centro.version + '/primus',
                            maxLength: 1 * 1024 * 1024
                        }, config, { transport: config.primus_transport }));

    function onclose(req, cb)
    {
        if (req.socket.destroyed)
        {
            return cb();
        }

        req.socket.on('close', cb);
    }

    server.authorize(function (req, cb)
    {
        authorize(req, function ()
        {
            cb({ statusCode: 503, message: 'closed' });
        }, function (cb)
        {
            onclose(req, cb);
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
                      onclose(spark.request, cb);
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

            server: server
        });
    }

    if (config.server)
    {
        return initialised();
    }

    server.on('initialised', initialised);
};

