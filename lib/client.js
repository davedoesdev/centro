"use strict";

var frame = require('frame-stream'),
    EventEmitter = require('events').EventEmitter,
    util = require('util'),
    async = require('async'),
    MQlobberClient = require('mqlobber').MQlobberClient,
    Ajv = require('ajv'),
    ajv = new Ajv(),
    validate = ajv.compile({
        type: 'object',
        required: ['self', 'prefixes'],
        properties: {
            self: {
                type: 'string'
            },
            prefixes: {
                type: 'array',
                items: {
                    type: 'string'
                }
            }
        }
    });

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
    var mqclient = new MQlobberClient(stream, config);

    function end()
    {
        mqclient.emit('error', new Error('ended before ready'));
    }

    mqclient.mux.on('end', end);

    mqclient.on('handshake', function (hsdata)
    {
        mqclient.mux.removeListener('end', end);

        try
        {
            hsdata = JSON.parse(hsdata);
        }
        catch (ex)
        {
            return this.emit('error', ex);
        }

        if (!validate(hsdata))
        {
            return this.emit('error', new Error(ajv.errorsText(validate.errors)));
        }

        this.self = hsdata.self;

        function replace(topic)
        {
            return topic.split('${self}').join(hsdata.self);
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

            this._orig_subscribe(hsdata.prefixes[n] + replace(topic),
            function (s, info, done)
            {
                info.topic = info.topic.substr(hsdata.prefixes[n].length).split(hsdata.self).join('${self}');
                handler(s, info, done);
            }, cb);
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

            if (topic === undefined)
            {
                async.eachSeries(this._subs.keys(), function (t, cb)
                {
                    if (t.lastIndexOf(hsdata.prefixes[n], 0) === 0)
                    {
                        // Remove while iterating on ES6 Maps is consistent
                        this._orig_unsubscribe(t, undefined, cb);
                    }
                    else
                    {
                        cb();
                    }
                }, cb);
            }
            else
            {
                this._orig_unsubscribe(hsdata.prefixes[n] + replace(topic),
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

        this.emit('ready');
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
