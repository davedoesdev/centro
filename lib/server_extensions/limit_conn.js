"use strict";

var Transform = require('stream').Transform;

exports.limit_conn_published_data = function (config)
{
    return {
        pre_connect: function (info)
        {
            var count = 0;

            info.mqserver.on('publish_requested', function (topic, duplex, options, cb)
            {
                var t = new Transform();

                t.on('error', this.relay_error);

                t._transform = function (chunk, enc, cont)
                {
                    count += chunk.length;

                    if (count > config.max_conn_published_data_length)
                    {
                        cont(new Error('published data limit ' + config.max_conn_published_data_length +
                                       ' exceeded: ' + topic));
                        return info.destroy();                        
                    }

                    this.push(chunk);
                    cont();
                };

                duplex.pipe(t).pipe(this.fsq.publish(topic, options, cb));
            });
        }
    };
};

exports.limit_conn_published_messages = function (config)
{
    return {
        pre_connect: function (info)
        {
            var count = 0;

            info.mqserver.on('publish_requested', function (topic, duplex, options, cb)
            {
                count += 1;

                if (count > config.max_conn_published_messages)
                {
                    duplex.emit(new Error(
                            'published message limit ' + config.max_conn_published_messages +
                            ' exceeded: ' + topic));
                    return info.destroy();                        
                }

                duplex.pipe(this.fsq.publish(topic, options, cb));
            });
        }
    };
};
