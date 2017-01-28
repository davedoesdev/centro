"use strict";

exports.timeout_publish_streams = function (config)
{
    return {
        pre_connect: function (info)
        {
            info.mqserver.on('publish_requested', function (topic, duplex, options, cb)
            {
                var t = null,
                    d = this.fsq.publish(topic, options, function (err)
                    {
                        clearTimeout(t);
                        cb(err);
                    });

                t = setTimeout(function ()
                {
                    d.emit('error', new Error('timeout'));
                }, config.timeout);

                duplex.pipe(d);
            });
        }
    };
};

exports.timeout_message_streams = function (config)
{
    return {
        pre_connect: function (info)
        {
            info.mqserver.on('message', function (stream, info, multiplex)
            {
                var d = multiplex(),
                    t = setTimeout(function ()
                    {
                        d.emit('error', new Error('timeout'));
                    }, config.timeout);

                d.on('finish', function ()
                {
                    clearTimeout(t);
                });

                stream.pipe(d);
            });
        }
    };
};
