"use strict";

var url = require('url');

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

exports.timeout_http_publish_requests = function (config)
{
    return {
        transport_ready: function (tconfig, ops)
        {
            var cfg = Object.assign({}, config, tconfig);

            if (cfg.http_publish_timeout && ops.server)
            {
                ops.server.on('request', function (req)
                {
                    if (!ops.pub_pathname ||
                        (url.parse(req.url).pathname === ops.pub_pathname))
                    {
                        req.setTimeout(cfg.http_publish_timeout, function ()
                        {
                            req.destroy();
                        });
                    }
                });
            }
        }
    };
};
