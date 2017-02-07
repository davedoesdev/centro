"use strict";

var Throttle = require('stream-throttle').Throttle;

exports.throttle_publish_streams = function (config, pipeline)
{
    return {
        pre_connect: function (info)
        {
            pipeline(info.mqserver, 'publish_requested', function (topic, duplex, options, cb, next)
            {
                var t = new Throttle(config);
                t.on('error', this.relay_error);
                duplex.pipe(t);
                next(topic, t, options, cb);
            });
        }
    };
};

exports.throttle_message_streams = function (config, pipeline)
{
    return {
        pre_connect: function (info)
        {
            pipeline(info.mqserver, 'message', function (stream, info, multiplex, cb, next)
            {
                var t = new Throttle(config);
                t.on('error', this.relay_error);
                stream.pipe(t);
                next(t, info, multiplex, cb);
            });
        }
    };
};
