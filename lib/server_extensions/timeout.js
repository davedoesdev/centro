"use strict";

var url = require('url');

exports.timeout_publish_streams = function (config, pipeline)
{
    return {
        pre_connect: function (info)
        {
            pipeline(info.mqserver, 'publish_requested', function (topic, duplex, options, cb, next)
            {
                var t = setTimeout(function ()
                {
                    duplex.emit('error', new Error('timeout'));
                }, config.timeout);

                next(topic, duplex, options, function (err)
                {
                    clearTimeout(t);
                    cb(err);
                });
            });
        }
    };
};

exports.timeout_message_streams = function (config, pipeline)
{
    return {
        pre_connect: function (info)
        {
            pipeline(info.mqserver, 'message', function (stream, info, multiplex, cb, next)
            {
                var t = setTimeout(function ()
                {
                    stream.emit('error', new Error('timeout'));
                }, config.timeout);

                next(stream, info, function (on_error)
                {
                    var duplex = multiplex(on_error);

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

exports.timeout_http_publish_requests = function (config, pipeline)
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
