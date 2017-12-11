/**
 * Centro extension for defining {@link https://github.com/davedoesdev/mqlobber#mqlobberservereventsbackoff|backoff} event behaviour.
 *
 * @module centro-js/lib/server_extensions/backoff
 */
"use strict";

var wu = require('wu'),
    bo_prop = 'centro_server_extension_backoff';

/**
 * Attach behaviour to the {@link https://github.com/davedoesdev/mqlobber#mqlobberservereventsbackoff|backoff} event.
 *
 * @param {Object} config - Configuration options.
 * @param {boolean} [config.close_conn] - Close connection when a `backoff` event occurs.
 * @param {boolean} [config.delay_responses] - When a `backoff` event occurs, delay responses to subscribe, unsubscribe and publish requests from the client until a {@link https://github.com/davedoesdev/mqlobber#mqlobberservereventsdrain|drain} event occurs.
 * @param {boolean} [config.skip_message] - When a `backoff` event occurs, drop messages that would be sent to the client until a `drain` event occurs.
 * @param {centro-js/lib/server_extensions/backoff.skipCallback} [config.on_skip] - Called when a message is dropped.
 * @param {boolean} [config.delay_message] - When a `backoff` event occurs, postpone messages that would be sent to the client until a `drain` event occurs.
 * @param {centro-js/lib/server_extensions/backoff.delayCallback} [config.on_delay] - Called when a message is postponed.
 */
exports.backoff = function (config)
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
                this.pipeline(info.mqserver, 'subscribe_requested', function (topic, cb, next)
                {
                    next(topic, delay_response(cb));
                });

                this.pipeline(info.mqserver, 'unsubscribe_requested', function (topic, cb, next)
                {
                    next(topic, delay_response(cb));
                });

                this.pipeline(info.mqserver, 'unsubscribe_all_requested', function (cb, next)
                {
                    next(delay_response(cb));
                });

                this.pipeline(info.mqserver, 'publish_requested', function (topic, stream, options, cb, next)
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

/**
 * Callback type for dropping a message.
 *
 * @callback skipCallback
 * @memberof centro-js/lib/server_extensions/backoff
 * @param {Object} info - Metadata for the message. See {@link https://github.com/davedoesdev/mqlobber#mqlobberservereventsmessagestream-info-multiplex-done|MQlobber.events.message} for details.
 */
/* istanbul ignore next */
exports._skipCallback = function (info) {};


/**
 * Callback type for postponing a message.
 *
 * @callback delayCallback
 * @memberof centro-js/lib/server_extensions/backoff
 * @param {Object} info - Metadata for the message. See {@link https://github.com/davedoesdev/mqlobber#mqlobberservereventsmessagestream-info-multiplex-done|MQlobber.events.message} for details.
 */
/* istanbul ignore next */
exports._delayCallback = function (info) {};
