"use strict";

exports.limit_active_subscriptions = function (config)
{
    var count = 0;
    
    return {
        pre_connect: function (info)
        {
            info.mqserver.on('subscribe_requested', function (topic, cb)
            {
                if ((count >= config.max_subscriptions) &&
                    !this.subs.has(topic))
                {
                    return cb(new Error('subscription limit ' + config.max_subscriptions +
                                        ' already reached: ' + topic));
                }

                this.subscribe(topic, function (err, n)
                {
                    count += n;
                    cb(err);
                });
            });

            info.mqserver.on('unsubscribe_requested', function (topic, cb)
            {
                this.unsubscribe(topic, function (err, n)
                {
                    count -= n;
                    cb(err);
                });
            });

            info.mqserver.on('unsubscribe_all_requested', function (cb)
            {
                this.unsubscribe(function (err, n)
                {
                    count -= n;
                    cb(err);
                });
            });
        }
    };
};

exports.limit_active_publications = function (config)
{
    var count = 0;

    return {
        pre_connect: function (info)
        {
            info.mqserver.on('publish_requested', function (topic, stream, options, cb)
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

                stream.pipe(this.fsq.publish(topic, options, cb2));
            });
        }
    };
};

/*exports.limit_active_connections = function (config)
{


};*/
