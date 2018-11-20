/*eslint-env node */

/**
 * Primus transport. This allows messages to be sent over {@link https://github.com/primus/primus|Primus} connections.
 *
 * @module centro-js/lib/server_transports/primus
 * @param {Object} config - Configuration options. This supports all the options supported by `Primus.createServer` and {@link https://github.com/davedoesdev/primus-backpressure#primusduplexmsg_stream-options|PrimusDuplex} as well as the following:
 * @param {Primus} [config.server] - If you want to supply your own Primus server object. Otherwise, `Primus.createServer` will be called to create one.
 * @param {string} [config.pathname=/centro/v2/primus] - Pathname prefix on which Primus listens for connections.
 * @param {Object} [config.primus_transport] - Primus transformer-specific configuration.
 * @param {Object} [config.primus] - If present then this is used in preference to `config`.
 */
"use strict";

var centro = require('../..'),
    Primus = require('primus'),
    PrimusDuplex = require('primus-backpressure').PrimusDuplex,
    on_connection = require('./http').on_connection;

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

    const on_conn = on_connection.bind(server.server, warning);

    server.on('connection', connection);
    server.on('error', error);
    server.server.on('connection', on_conn);
    server.server.on('secureConnection', on_conn);

    function initialised()
    {
        ready(null,
        {
            close: function (cb)
            {
                server.auth = null;
                server.removeListener('connection', connection);
                server.removeListener('error', error);
                server.server.removeListener('connection', on_conn);
                server.server.removeListener('secureConnection', on_conn);

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

