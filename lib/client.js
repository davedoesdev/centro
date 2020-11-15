/*eslint-env node */

/**
 * Centro client functions
 * @module centro-js/lib/client
 * @author David Halls <https://github.com/davedoesdev/>
 * @copyright (c) 2020 David Halls
 * @license MIT
 */
"use strict";

var frame = require('frame-stream'),
    async = require('async'),
    MQlobberClient = require('mqlobber/lib/client').MQlobberClient,
    Ajv = require('ajv'),
    ajv = new Ajv(),
    { get_topic_pattern } = require('./pattern');

exports.version = require('./version');
exports.version_buffer = Buffer.alloc(4),
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
    config = Object.assign(
        stream._no_keep_alive ? { keep_alive: false } : {},
        config);

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

        var num_prefixes;
        
        if ((typeof config.token === 'string') ||
            (typeof config.token === 'undefined'))
        {
            num_prefixes = 1;
        }
        else
        {
            num_prefixes = config.token.length;
        }

        const matcher = mqclient._matcher;

        const pattern_config = {
            separator: matcher._separator,
            wildcard_some: matcher._wildcard_some,
            max_words: matcher._max_words,
            max_wildcard_somes: matcher._max_wildcard_somes,
            max_topic_length: config.max_topic_length
        };

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
                    minItems: num_prefixes,
                    maxItems: num_prefixes,
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
                    maxItems: num_prefixes,
                    items: {
                        type: 'object',
                        maxProperties: config.max_subscriptions,
                        additionalProperties: false,
                        patternProperties: {
                            [get_topic_pattern(pattern_config)]: {
                                type: 'boolean'
                            }
                        }
                    }
                },
                version: {
                    type: 'integer',
                    enum: [exports.version]
                }
            }
        }, hsdata))
        {
            var msg = ajv.errorsText(ajv.errors);

            if (ajv.validate({
                type: 'object',
                required: ['error', 'version'],
                additionalProperties: false,
                properties: {
                    error: {
                        type: 'string'
                    },
                    version: {
                        type: 'integer',
                        enum: [exports.version]
                    }
                }
            }, hsdata))
            {
                return this.emit('error', new Error(hsdata.error));
            }

            return this.emit('error', new Error(msg));
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
                    if (Object.prototype.hasOwnProperty.call(subscription, topic))
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

            if (n >= hsdata.prefixes.length)
            {
                return cb(new Error('token out of range'));
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
                    if (handlers.get(topic) === handler2)
                    {
                        handler.call(this, s, Object.assign({}, info,
                        {
                            topic: info.topic.substr(hsdata.prefixes[n].length).split(hsdata.self).join('${self}')
                        }), done);
                    }
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

            if (n >= hsdata.prefixes.length)
            {
                return cb(new Error('token out of range'));
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

            if (typeof options === 'function')
            {
                cb = options;
                options = undefined;
            }

            if (n >= hsdata.prefixes.length)
            {
                cb(new Error('token out of range'));
                return null;
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

/**
 * Get authorization data for transports which use HTTP Basic Authentication
 * (currently Primus) and then initiate communication with a server on a stream
 * you supply.
 *
 * @param {Object} [config] - Configuration options. This supports all the options supported by {@link https://github.com/davedoesdev/mqlobber#mqlobberclientstream-options|MQlobberClient} as well as the following:
 * @param {string|string[]} [config.token] - JSON Web Token(s) to present to the server.
 * @param {integer} [config.max_subscriptions] - If the server returns pre-subscription data (see the {@link centro-js/lib/client.event:MQlobberClient#ready|ready} event), emit an `error` event if there are more entries than this maximum. If not specified, no limit is applied.
 * @param {integer} [config.max_topic_length] - If the server returns pre-subscription data (see the {@link centro-js/lib/client.event:MQlobberClient#ready|ready} event), emit an `error` event if one of the topics exceeds this length. If not specified, no limit is applied.
 * @param {centro-js/lib/client.authzCallback} cb - Called with authorization data.
 */
exports.separate_auth = function (config, cb)
{
    if (!cb)
    {
        cb = config;
        config = {};
    }

    var stokens;
    
    try
    {
        stokens = get_stokens(config);
    }
    catch (ex)
    {
        return cb(ex);
    }

    cb(null, 'centro:' + stokens, function (stream)
    {
        return start(stream, config);
    });
};

/**
 * Authorize with a server on a stream, for transports which send authorization
 * data as a stream header (currently all except Primus and HTTP).
 *
 * @param {stream.Duplex} stream - Connection you've already made to the server.
 * @param {Object} [config] - Configuration options. This supports all the options supported by {@link https://github.com/davedoesdev/mqlobber#mqlobberclientstream-options|MQlobberClient} as well as the following:
 * @param {string|string[]} [config.token] - JSON Web Token(s) to present to the server.
 * @param {integer} [config.max_subscriptions] - If the server returns pre-subscription data (see the {@link centro-js/lib/client.event:MQlobberClient#ready|ready} event), emit an `error` event if there are more entries than this maximum. If not specified, no limit is applied.
 * @param {integer} [config.max_topic_length] - If the server returns pre-subscription data (see the {@link centro-js/lib/client.event:MQlobberClient#ready|ready} event), emit an `error` event if one of the topics exceeds this length. If not specified, no limit is applied.
 * @returns {MQlobberClient} - Object you can use for publishing and subscribing to messages. See the {@link https://github.com/davedoesdev/mqlobber#mqlobberclientstream-options|mqlobber documentation}.
 */
exports.stream_auth = function (stream, config)
{
    // write frame

    var out_stream = frame.encode(config);

    out_stream._pushFrameData = function (bufs)
    {
        for (var buf of bufs)
        {
            stream.write(buf);
        }
    };

    out_stream.end(get_stokens(config));

    return start(stream, config);
};

/*eslint-disable no-unused-vars */

/**
 * Callback type for HTTP Basic Authentication data.
 *
 * @callback authzCallback
 * @memberof centro-js/lib/client
 * @param {?Error} err - Error, if one occurred.
 * @param {string} userpass - Authentication data in the form `centro:<tokens>` where `<tokens>` a comma-separated list of tokens you passed to {@link centro-js/lib/client.separate_auth}.
 * @param {streamCallback} cb - Call this when you've made a connection to the server.
 */
/* istanbul ignore next */
exports._authzCallback = function (err, userpass, cb) {};

/**
  * Callback type for connection to server.
  *
  * @callback streamCallback
  * @memberof centro-js/lib/client
  * @param {stream.Duplex} stream - Connection you've made to the server.
  * @returns {MQlobberClient} - Object you can use for publishing and subscribing to messages. See the {@link https://github.com/davedoesdev/mqlobber#mqlobberclientstream-options|mqlobber documentation}.
  */
/* istanbul ignore next */
exports._streamCallback = function (stream) {};

/**
  * Ready event. This is an extra event added to {@link https://github.com/davedoesdev/mqlobber#mqlobberclientstream-options|MQlobberClient} and is emitted when the server has authorized the client and a connection is established.
  *
  * @event MQlobberClient#ready
  * @memberof centro-js/lib/client
  * @param {Object.<string, boolean>[]} [subscriptions] - For each authorization token you supplied to {@link centro-js/lib/client.separate_auth} or {@link centro-js/lib/client.stream_auth}, a map containing the topics to which the client has been pre-subscribed. Each topic maps to whether the client will receive existing messages for the topic (`true`) or just new ones (`false`). If no tokens specified any pre-subscriptions then this will be `undefined`.
  */
/* istanbul ignore next */
exports._ready_event = function (subscriptions) {};
