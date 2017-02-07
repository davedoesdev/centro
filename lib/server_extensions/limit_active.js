"use strict";

exports.limit_active_subscriptions = function (config, pipeline)
{
    var count = 0;
    
    return {
        pre_connect: function (info)
        {
            pipeline(info.mqserver, 'subscribe_requested', function (topic, cb, next)
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
                    cb(err);
                });
            });

            pipeline(info.mqserver, 'unsubscribe_requested', function (topic, cb, next)
            {
                next(topic, function (err, n)
                {
                    count -= n;
                    cb(err);
                });
            });

            pipeline(info.mqserver, 'unsubscribe_all_requested', function (cb, next)
            {
                next(function (err, n)
                {
                    count -= n;
                    cb(err);
                });
            });
        }
    };
};

exports.limit_active_publications = function (config, pipeline)
{
    var count = 0;

    return {
        pre_connect: function (info)
        {
            pipeline(info.mqserver, 'publish_requested', function (topic, stream, options, cb, next)
            {
                if (count >= config.max_publications)
                {
                    return cb(new Error('publication limit ' + config.max_publications +
                                        ' already reached: ' + topic));
                }

                count += 1;

                var decrement = function (err, data)
                {
                    count -= 1;
                    cb(err, data);
                };

                function cb2(err, data)
                {
                    var dec = decrement;
                    decrement = cb; // only decrement once
                    dec(err, data);
                }

                next(topic, stream, options, cb2);
            });
        }
    };
};

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
