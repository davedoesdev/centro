
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

function PrefixedMQlobberClient(prefix, mqclient)
{
    EventEmitter.call(this);

    this._prefix = prefix;
    this._mqclient = mqclient;

    var ths = this;

    mqclient.on('backoff', function ()
    {
        ths.emit('backoff');
    });

    mqclient.on('error', function (err, obj)
    {
        ths.emit('error', err, obj);
    });

    mqclient.on('warning', function (err, obj)
    {
        ths.emit('warning', err, obj);
    });
}

util.inherits(PrefixedMQlobberClient, EventEmitter);

PrefixedMQlobberClient.prototype.subscribe = function (topic, handler, cb)
{
    this._mqclient.subscribe(this._prefix + topic, handler, cb);
};


PrefixedMQlobberClient.prototype.unsubscribe = function (topic, handler, cb)
{
    if (typeof topic === 'function')
    {
        cb = topic;
        topic = undefined;
        handler = undefined;
    }

    if (topic === undefined)
    {
        async.eachSeries(this._mqclient._subs.keys(), function (t, cb)
        {
            if (t.lastIndexOf(this._prefix, 0) === 0)
            {
                // Remove while iterating on ES6 Maps is consistent
                this._mqclient.unsubscribe(t, undefined, cb);
            }
            else
            {
                cb();
            }
        }, function (err)
        {
            if (cb)
            {
                cb(err);
            }
        });
    }
    else
    {
        this._mqclient.unsubscribe(this._prefix + topic, handler, cb);
    }
};

PrefixedMQlobberClient.prototype.publish = function (topic, options, cb)
{
    this._mqclient.publish(this._prefix + topic, options, cb);
};

function start(stream, config, cb)
{
    new MQlobberClient(stream, config).on('handshake', function (hsdata)
    {
        if (!validate(hsdata))
        {
            return cb(new Error(validate.errorsText));
        }

        var mqclients = hsdata.map(function (prefix)
        {
            return new PrefixedMQlobberClient(prefix, mqclient);
        });

        if (mqclients.length === 1 && tokens.length === 1)
        {
            mqclients = mqclients[0];
        }

        cb(null, mqclients);
    });
}

exports.separate_auth = function (config, cb)
{
    cb(null, 'dummy:' + get_stokens(config), function (stream, cb)
    {
        start(config, stream, cb);
    });
};

exports.stream_auth = function (stream, config, cb)
{
    write_frame(stream, get_stokens(config));
    start(config, stream, cb);
};
