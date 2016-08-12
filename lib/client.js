
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

module.exports = function (config)
{
    var tokens = config.tokens;

    if (typeof tokens === 'string')
    {
        tokens = [tokens];
    }

    config.transport(config, function (obj, cb)
    {
        var stokens = tokens.join(',');

        if (obj.url)
        {
            obj.auth = stokens;
        }
        else
        {
            write_frame(obj, stokens);
        }

        cb(obj);
    }, function (stream)
    {
    // we need to make mqlobbers from them all
    // and prefix the issuer id
    // which means we need to send back info in the initial handshake
    // but we only have one mqlobber; we'll need to make passthrough ones
    // which prepend their issuer ids
    // want array order of mqlobbers returned to be same as tokens order
    // will have to distribute events to them (look at topic prefix)
    // if only one token then don't bother


    }, config.error || console.error);
};
