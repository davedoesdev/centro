/**
 * Centro extension for limiting the rate of messages streams.
 *
 * @module centro-js/lib/server_extensions/throttle
 */
"use strict";

var Throttle = require('stream-throttle').Throttle;

/**
 * Limit the rate at which message data can be published by clients.
 *
 * @param {Object} config - See {@link https://github.com/tjgq/node-stream-throttle|Throttle}.
 */
exports.throttle_publish_streams = function (config)
{
    return {
        pre_connect: function (info)
        {
            this.pipeline(info.mqserver, 'publish_requested', function (topic, duplex, options, cb, next)
            {
                var t = new Throttle(config);
                t.on('error', this.relay_error);
                duplex.pipe(t);
                next(topic, t, options, cb);
            });
        }
    };
};

/**
 * Limit the rate at which message data is sent to clients.
 *
 * @param {Object} config - See {@link https://github.com/tjgq/node-stream-throttle|Throttle}.
 */
exports.throttle_message_streams = function (config)
{
    return {
        pre_connect: function (info)
        {
            this.pipeline(info.mqserver, 'message', function (stream, info, multiplex, cb, next)
            {
                var t = new Throttle(config);
                t.on('error', this.relay_error);
                stream.pipe(t);
                next(t, info, multiplex, cb);
            });
        }
    };
};
