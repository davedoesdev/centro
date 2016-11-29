"use strict";

var frame = require('frame-stream'),
    EventEmitter = require('events').EventEmitter,
    util = require('util'),
    async = require('async'),
    MQlobberClient = require('mqlobber').MQlobberClient,
    Ajv = require('ajv'),
    ajv = new Ajv();

exports.version = require('./version');
exports.version_buffer = new Buffer(4),
/*jshint expr: true */
exports.version_buffer.writeUInt32BE(exports.version, 0, true);
/*jshint expr: false */

function get_stokens(config)
{
    var tokens = config.token;

    if (typeof tokens === 'string')
    {
        tokens = [tokens];
    }

    return tokens.join(',');
}

function start(stream, config)
{
    config = Object.assign({}, config);

    var bufs = [exports.version_buffer];
    if (config.handshake_data)
    {
        bufs.push(config.handshake_data);
    }
    config.handshake_data = Buffer.concat(bufs);

    var mqclient = new MQlobberClient(stream, config);
    
    mqclient.on('handshake', function (hsdata)
    {
        try
        {
            hsdata = JSON.parse(hsdata);
        }
        catch (ex)
        {
            return this.emit('error', ex);
        }

        var num_tokens = typeof config.token === 'string' ?
                1 : config.token.length,
                sub_additional_properties,
                sub_pattern_properties;

        if (config.max_topic_length === undefined)
        {
            sub_additional_properties = { type: 'boolean' };
        }
        else
        {
            sub_additional_properties = false;
            sub_pattern_properties = {};
            sub_pattern_properties["^.{0," + config.max_topic_length + "}$"] =
                    { type: 'boolean' };
        }

        if (!ajv.validate({
            type: 'object',
            required: ['self', 'prefixes', 'version'],
            additionalProperties: false,
            properties: {
                self: {
                    type: 'string'
                },
                prefixes: {
                    type: 'array',
                    minItems: num_tokens,
                    maxItems: num_tokens,
                    items: {
                        type: 'string',
                        oneOf: [{
                            minLength: 65,
                            maxLength: 65
                        }, {
                            minLength: 0,
                            maxLength: 0
                        }]
                    }
                },
                subscriptions: {
                    type: 'array',
                    maxItems: num_tokens,
                    items: {
                        type: 'object',
                        maxProperties: config.max_subscriptions,
                        additionalProperties: sub_additional_properties,
                        patternProperties: sub_pattern_properties
                    }
                },
                version: {
                    type: 'integer',
                    enum: [exports.version]
                }
            }
        }, hsdata))
        {
            return this.emit('error', new Error(ajv.errorsText(ajv.errors)));
        }

        this.self = hsdata.self;

        function replace(topic)
        {
            return topic.split('${self}').join(hsdata.self);
        }

        if (hsdata.subscriptions)
        {
            for (var i = 0; i < hsdata.subscriptions.length; i += 1)
            {
                var subscription = hsdata.subscriptions[i];
                for (var topic in subscription)
                {
                    /* istanbul ignore else */
                    if (subscription.hasOwnProperty(topic))
                    {
                        this.subs.set(hsdata.prefixes[i] + topic, new Set());
                    }
                }
            }
        }

        this._orig_subscribe = this.subscribe;
        this.subscribe = function (n, topic, handler, cb)
        {
            if (typeof n !== 'number')
            {
                cb = handler;
                handler = topic;
                topic = n;
                n = 0;
            }

            topic = hsdata.prefixes[n] + replace(topic);

            var centro_subs = handler._centro_subs;
            if (!centro_subs)
            {
               centro_subs = handler._centro_subs = new Map();
            }

            var handlers = centro_subs.get(this);
            if (!handlers)
            {
                handlers = new Map();
                centro_subs.set(this, handlers);
            }

            var handler2 = handlers.get(topic);
            if (!handler2)
            {
                handler2 = function (s, info, done)
                {
                    handler.call(this, s, Object.assign({}, info,
                    {
                        topic: info.topic.substr(hsdata.prefixes[n].length).split(hsdata.self).join('${self}')
                    }), done);
                };
                handler2.handler = handler;
                handlers.set(topic, handler2);
            }
                
            this._orig_subscribe(topic, handler2, cb);
        };

        this._orig_unsubscribe = this.unsubscribe;
        this.unsubscribe = function (n, topic, handler, cb)
        {
            if (typeof n !== 'number')
            {
                cb = handler;
                handler = topic;
                topic = n;
                n = 0;
            }

            if (typeof topic === 'function')
            {
                cb = topic;
                topic = undefined;
                handler = undefined;
            }

            var ths = this;

            function unsub(t, h)
            {
                var centro_subs = h._centro_subs;
                if (!centro_subs)
                {
                    return h;
                }

                var handlers = centro_subs.get(ths);
                if (!handlers)
                {
                    return h;
                }

                var h2 = handlers.get(t);
                if (!h2)
                {
                    return h;
                }

                handlers.delete(t);
                if (handlers.size === 0)
                {
                    centro_subs.delete(ths);
                    if (centro_subs.size === 0)
                    {
                        delete h._centro_subs;
                    }
                }

                return h2;
            }

            if (topic === undefined)
            {
                async.eachSeries(this.subs, function (th, cb)
                {
                    if (th[0].lastIndexOf(hsdata.prefixes[n], 0) === 0)
                    {
                        for (var h of th[1])
                        {
                            unsub(th[0], h.handler);
                        }
                        // Remove while iterating on ES6 Maps is consistent
                        ths._orig_unsubscribe(th[0], undefined, cb);
                    }
                    else
                    {
                        cb();
                    }
                }, cb);
            }
            else
            {
                topic = hsdata.prefixes[n] + replace(topic);

                if (handler === undefined)
                {
                    var hs = this.subs.get(topic);
                    if (hs !== undefined)
                    {
                        for (var h of hs)
                        {
                            unsub(topic, h.handler);
                        }
                    }
                }
                else
                {
                    handler = unsub(topic, handler);
                }

                this._orig_unsubscribe(topic,
                                       handler,
                                       cb);
            }
        };

        this._orig_publish = this.publish;
        this.publish = function (n, topic, options, cb)
        {
            if (typeof n !== 'number')
            {
                cb = options;
                options = topic;
                topic = n;
                n = 0;
            }

            return this._orig_publish(hsdata.prefixes[n] + replace(topic),
                                      options,
                                      cb);
        };

        this.emit('ready', hsdata.subscriptions);
    });

    return mqclient;
}

exports.start = start;

exports.separate_auth = function (config, cb)
{
    cb(null, 'centro:' + get_stokens(config), function (stream)
    {
        return start(stream, config);
    });
};

exports.stream_auth = function (stream, config)
{
    // write frame

    var out_stream = frame.encode(config);

    out_stream._pushFrameData = function (bufs)
    {
        for (let buf of bufs)
        {
            stream.write(buf);
        }
    };

    out_stream.end(get_stokens(config));

    return start(stream, config);
};
