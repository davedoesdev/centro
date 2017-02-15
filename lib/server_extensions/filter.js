"use strict";

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
