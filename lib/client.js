
var frame = require('frame-stream'),
    MQlobberClient = require('mqlobber').MQlobberClient,
    Ajv = require('ajv'),
    ajv = new Ajv(),
    validate = ajv.compile({
        type: 'array',
        items: {
            type: 'string'
        }
    });

function PrefixedMQlobberClient(prefix, client)
{


}

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

function start(stream, config, cb)
{

// can we expose MQlobberClient somehow?
// inherit? And override some of the methods?


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
