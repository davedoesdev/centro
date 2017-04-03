"use strict";

var wu = require('wu'),
    bo_prop = 'centro_server_extension_backoff';

exports.backoff = function (config, pipeline)
{
    if (config.close_conn)
    {
        return {
            pre_connect: function (info)
            {
                info.mqserver.on('backoff', function ()
                {
                    info.destroy();
                });
            }
        };
    }

    var r = {
        pre_connect: function (info)
        {
            info.mqserver.on('backoff', function ()
            {
                this[bo_prop] = true;
            });

            info.mqserver.on('drain', function ()
            {
                this[bo_prop] = false;
            });

            function delay_response(cb)
            {
                return function ()
                {
                    if (info.mqserver[bo_prop])
                    {
                        var args = Array.prototype.slice.call(arguments);

                        return info.mqserver.once('drain', function ()
                        {
                            cb.apply(this, args);
                        });
                    }

                    cb.apply(this, arguments);
                };
            }

            if (config.delay_responses)
            {
                pipeline(info.mqserver, 'subscribe_requested', function (topic, cb, next)
                {
                    next(topic, delay_response(cb));
                });

                pipeline(info.mqserver, 'unsubscribe_requested', function (topic, cb, next)
                {
                    next(topic, delay_response(cb));
                });

                pipeline(info.mqserver, 'unsubscribe_all_requested', function (cb, next)
                {
                    next(delay_response(cb));
                });

                pipeline(info.mqserver, 'publish_requested', function (topic, stream, options, cb, next)
                {
                    next(topic, stream, options, delay_response(cb));
                });
            }
        }
    };

    if (config.skip_message)
    {
        r.ready = function ()
        {
            this.fsq.filters.push(function (info, handlers, cb)
            {
                cb(null, true, wu(handlers).filter(function (h)
                {
                    if (h.mqlobber_server && h.mqlobber_server[bo_prop])
                    {
                        /* istanbul ignore else */
                        if (config.on_skip)
                        {
                            config.on_skip(info, handlers, h);
                        }

                        return false;
                    }

                    return true;
                }));
            });
        };
    }
    else if (config.delay_message)
    {
        r.ready = function ()
        {
            this.fsq.filters.push(function (info, handlers, cb)
            {
                for (var h of handlers)
                {
                    if (h.mqlobber_server && h.mqlobber_server[bo_prop])
                    {
                        /* istanbul ignore else */
                        if (config.on_delay)
                        {
                            config.on_delay(info, handlers, h);
                        }

                        return cb(null, false);
                    }
                }

                return cb(null, true, handlers);
            });
        };
    }

    return r;
};
