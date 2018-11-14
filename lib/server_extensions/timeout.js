/*eslint-env node */

/**
 * Centro extension for limiting how long message streams can be open.
 *
 * @module centro-js/lib/server_extensions/timeout
 */
"use strict";

var url = require('url');

/**
 * Limit how long a client can take to publish a message.
 *
 * @param {Object} config - Configuration options.
 * @param {integer} config.timeout - Time limit in milliseconds.
 */
exports.timeout_publish_streams = function (config)
{
    return {
        pre_connect: function (info)
        {
            this.pipeline(info.mqserver, 'publish_requested', function (topic, duplex, options, cb, next)
            {
                var t = setTimeout(function ()
                {
                    duplex.emit('error', new Error('timeout'));
                }, config.timeout);

                next(topic, duplex, options, function ()
                {
                    clearTimeout(t);
                    cb.apply(this, arguments);
                });
            });
        }
    };
};

/**
 * Limit how long a client can take to read a message.
 *
 * @param {Object} config - Configuration options.
 * @param {integer} config.timeout - Time limit in milliseconds.
 */
exports.timeout_message_streams = function (config)
{
    return {
        pre_connect: function (info)
        {
            this.pipeline(info.mqserver, 'message', function (stream, info, multiplex, cb, next)
            {
                var t = setTimeout(function ()
                {
                    stream.emit('error', new Error('timeout'));
                }, config.timeout);

                next(stream, info, function ()
                {
                    var duplex = multiplex.apply(this, arguments);

                    duplex.on('finish', function ()
                    {
                        clearTimeout(t);
                    });

                    return duplex;
                }, cb);
            });
        }
    };
};

/**
 * Limit how long the HTTP transport allows a client to take to publish a
 * message.
 *
 * @param {Object} config - Configuration options.
 * @param {integer} config.http_publish_timeout - Time limit in milliseconds.
 */
exports.timeout_http_publish_requests = function (config)
{
    return {
        transport_ready: function (tconfig, ops)
        {
            var cfg = Object.assign({}, config, tconfig);

            if (cfg.http_publish_timeout && ops.server && ops.pub_pathname)
            {
                ops.server.on('request', function (req)
                {
                    if (url.parse(req.url).pathname === ops.pub_pathname)
                    {
                        req.setTimeout(cfg.http_publish_timeout, function ()
                        {
                            req.destroy(new Error('timeout'));
                        });
                    }
                });
            }
        }
    };
};
