"use strict";

var FastestWritable = require('fastest-writable').FastestWritable;

exports.delay_message_until_all_streams_under_hwm = function ()
{
    return {
        ready: function ()
        {
            this.fsq.filters.push(function (info, handlers, cb)
            {
                for (var h of handlers)
                {
                    if (h.mqlobber_server)
                    {
                        for (var d of h.mqlobber_server.mux.duplexes.values())
                        {
                            if (d._writableState.length >= d._writableState.highWaterMark)
                            {
                                return cb(null, false);
                            }
                        }
                    }
                }

                cb(null, true, handlers);
            });
        }
    };
};

var fw_prop = 'centro_server_extension_filter_fastest_writable';

// must go last in pipeline
exports.fastest_writable = function (config, pipeline)
{
    return {
        pre_connect: function (info)
        {
            pipeline(info.mqserver, 'message', function (stream, info, multiplex, cb, next)
            {
                var fw = stream[fw_prop];

                if (!fw)
                {
                    stream[fw_prop] = new FastestWritable(config);
                }

                var duplex = multiplex(config.on_error);

                stream[fw_prop].add_peer(duplex);

                if (!fw)
                {
                    next(stream, info, function ()
                    {
                        return stream[fw_prop];
                    }, cb);
                }
            });
        }
    };
};
