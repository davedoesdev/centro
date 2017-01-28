"use strict";

var Throttle = require('stream-throttle').Throttle;

exports.throttle_publish_streams = function (config)
{
    return {
        pre_connect: function (info)
        {
            info.mqserver.on('publish_requested', function (topic, duplex, options, cb)
            {
                var t = new Throttle(config),
                    d = this.fsq.publish(topic, options, cb);

                t.on('error', this.relay_error);

                duplex.pipe(t).pipe(d);
            });
        }
    };
};

exports.throttle_message_streams = function (config)
{
    return {
        pre_connect: function (info)
        {
            info.mqserver.on('message', function (stream, info, multiplex)
            {
                var t = new Throttle(config),
                    d = multiplex();

                t.on('error', this.relay_error);

                stream.pipe(t).pipe(d);
            });
        }
    };
};
