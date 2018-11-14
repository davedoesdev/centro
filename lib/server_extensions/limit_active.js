/*eslint-env node */

/**
 * Centro extension for limiting the number of active subscriptions,
 * publications and connections.
 *
 * @module centro-js/lib/server_extensions/limit_active
 */
"use strict";

/**
 * Limit the total number of active subscriptions.
 *
 * @param {Object} config - Configuration options.
 * @param {integer} config.max_subscriptions - Maximum number of active subscriptions.
 */
exports.limit_active_subscriptions = function (config)
{
    var count = 0;
    
    return {
        pre_connect: function (info)
        {
            this.pipeline(info.mqserver, 'subscribe_requested', function (topic, cb, next)
            {
                if ((count >= config.max_subscriptions) &&
                    !this.subs.has(topic))
                {
                    return cb(new Error('subscription limit ' + config.max_subscriptions +
                                        ' already reached: ' + topic));
                }

                next(topic, function (err, n)
                {
                    count += n;
                    cb.apply(this, arguments);
                });
            });

            this.pipeline(info.mqserver, 'unsubscribe_requested', function (topic, cb, next)
            {
                next(topic, function (err, n)
                {
                    count -= n;
                    cb.apply(this, arguments);
                });
            });

            this.pipeline(info.mqserver, 'unsubscribe_all_requested', function (cb, next)
            {
                next(function (err, n)
                {
                    count -= n;
                    cb.apply(this, arguments);
                });
            });
        }
    };
};

/**
 * Limit the total number of active publications.
 *
 * @param {Object} config - Configuration options.
 * @param {integer} config.max_publications - Maximum number of active publications.
 */
exports.limit_active_publications = function (config)
{
    var count = 0;

    return {
        pre_connect: function (info)
        {
            this.pipeline(info.mqserver, 'publish_requested', function (topic, stream, options, cb, next)
            {
                if (count >= config.max_publications)
                {
                    return cb(new Error('publication limit ' + config.max_publications +
                                        ' already reached: ' + topic));
                }

                count += 1;

                var decrement = function ()
                {
                    count -= 1;
                    cb.apply(this, arguments);
                };

                /*jshint validthis: true */
                function cb2()
                {
                    var dec = decrement;
                    decrement = cb; // only decrement once
                    dec.apply(this, arguments);
                }

                next(topic, stream, options, cb2);
            });
        }
    };
};

/**
 * Limit the total number of active connections.
 *
 * @param {Object} config - Configuration options.
 * @param {integer} config.max_connections - Maximum number of active connections.
 */
exports.limit_active_connections = function (config)
{
    var count = 0;

    return {
        authz_start: function (cancel, onclose)
        {
            count += 1;

            onclose(function ()
            {
                count -= 1;
            });

            if (count > config.max_connections)
            {
                cancel(new Error('connection limit ' + config.max_connections +
                                 ' exceeded'));
            }
        }
    };
};
