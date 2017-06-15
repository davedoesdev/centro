/**
 * Centro extension for defining {@link https://github.com/davedoesdev/mqlobber#mqlobberservereventsfull|full} event behaviour.
 *
 * @module centro-js/lib/server_extensions/full
 * @param {Object} config - Configuration options.
 * @param {boolean} [config.close_conn] - Close connection when a `full` event occurs.
 * @param {boolean} [config.skip_message] - When a `full` event occurs, drop messages that would be sent to the client until a {@link https://github.com/davedoesdev/mqlobber#mqlobberservereventsremovedduplex|removed} event occurs.
 * @param {boolean} [config.delay_message] - When a `full` event occurs, postpone messages that would be sent to the client until a `removed` event occurs.
 */
"use strict";

var wu = require('wu'),
    fl_prop = 'centro_server_extension_full';

exports.full = function (config, pipeline)
{
    if (config.close_conn)
    {
        return {
            pre_connect: function (info)
            {
                info.mqserver.on('full', function ()
                {
                    info.destroy();
                });
            }
        };
    }

    var r = {
        pre_connect: function (info)
        {
            info.mqserver.on('full', function ()
            {
                this[fl_prop] = true;
            });

            info.mqserver.on('removed', function ()
            {
                this[fl_prop] = false;
            });
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
                    if (h.mqlobber_server && h.mqlobber_server[fl_prop])
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
    // https://github.com/gotwarlost/istanbul/issues/781
    else { /* istanbul ignore else */ if (config.delay_message)
    {
        r.ready = function ()
        {
            this.fsq.filters.push(function (info, handlers, cb)
            {
                for (var h of handlers)
                {
                    if (h.mqlobber_server && h.mqlobber_server[fl_prop])
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
    }}

    return r;
};
