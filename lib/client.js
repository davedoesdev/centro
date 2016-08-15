
var frame = require('frame-stream'),
    EventEmitter = require('events').EventEmitter,
    util = require('util'),
    async = require('async'),
    MQlobberClient = require('mqlobber').MQlobberClient,
    Ajv = require('ajv'),
    ajv = new Ajv(),
    validate = ajv.compile({
        type: 'array',
        items: {
            type: 'string'
        }
    });

function write_frame(s, header)
{
    var out_stream = frame.encode();
    out_stream._pushFrameData = function (bufs)
    {
        for (let buf of bufs)
        {
            s.write(buf);
        }
    };
    out_stream.end(header);
}

function get_stokens(config)
{
    var tokens = config.tokens;

    if (typeof tokens === 'string')
    {
        tokens = [tokens];
    }

    return tokens.join(',');
}

function start(stream, config)
{
    var mqclient = new MQlobberClient(stream, config);

    mqclient.on('handshake', function (hsdata)
    {
        if (!validate(hsdata))
        {
            return this.emit('error', new Error(validate.errorsText));
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

            this._orig_subscribe(hsdata[n] + topic, handler, cb);
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
                    if (t.lastIndexOf(hsdata[n], 0) === 0)
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
                this._orig_unsubscribe(hsdata[n] + topic, handler, cb);
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

            this._orig_publish(hsdata[0] + topic, options, cb);
        };
    });

    return mqclient;
}

exports.separate_auth = function (config, cb)
{
    cb(null, 'centro:' + get_stokens(config), function (stream)
    {
        return start(config, stream);
    });
};

exports.stream_auth = function (stream, config)
{
    write_frame(stream, get_stokens(config));
    return start(config, stream);
};
