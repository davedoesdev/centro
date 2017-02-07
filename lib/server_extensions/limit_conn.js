"use strict";

var Transform = require('stream').Transform;

exports.limit_conn_published_data = function (config, pipeline)
{
    return {
        pre_connect: function (info)
        {
            var count = 0;

            pipeline(info.mqserver, 'publish_requested', function (topic, duplex, options, cb, next)
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

                        if (config.close_conn)
                        {
                            return info.destroy();                        
                        }

                        return;
                    }

                    this.push(chunk);
                    cont();
                };

                duplex.pipe(t);
                
                next(topic, t, options, cb);
            });
        }
    };
};

exports.limit_conn_published_messages = function (config, pipeline)
{
    return {
        pre_connect: function (info)
        {
            var count = 0;

            pipeline(info.mqserver, 'publish_requested', function (topic, duplex, options, cb, next)
            {
                count += 1;

                if (count > config.max_conn_published_messages)
                {
                    cb(new Error('published message limit ' + config.max_conn_published_messages +
                                 ' exceeded: ' + topic));

                    if (config.close_conn)
                    {
                        return info.destroy();                        
                    }

                    return;
                }

                next(topic, duplex, options, cb);
            });
        }
    };
};
