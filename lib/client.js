
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

function PrefixedMQlobberClient(prefix, client

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

exports.write_tokens = function (config, obj, cb)
{
    var tokens = config.tokens;

    if (typeof tokens === 'string')
    {
        tokens = [tokens];
    }

    var stokens = tokens.join(',');

    if (obj.url)
    {
        obj.auth = stokens;
    }
    else
    {
        write_frame(obj, stokens);
    }

    cb(null, obj);
};

exports.start = function (config, stream, cb)
{

    config.transport(config, function (obj, cb)
    {
    }, function (stream)
    {
        var mqclient = new MQlobberClient(stream)

        mqclient.on('handshake', function (hsdata)
        {
            if (!validate(hsdata))
            {
                return error(new Error(validate.errorsText));
            }

            var mqclients = hsdata.map(function (prefix)
            {
                return new PrefixedMQlobberClient(prefix, mqclient);
            });

            cb(mqclients.length === 1 && tokens.length === 1 ?
                    mqclients[0] : mqclients);
        });


    // but we only have one mqlobber; we'll need to make passthrough ones
    // which prepend their issuer ids
    // will have to distribute events to them (look at topic prefix)
    // if only one token then don't bother



    }, error);
};
