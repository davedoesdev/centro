
var net = require('net'),
;

module.exports = function (config, tokens, connected, error)
{
    net.createConnection(config)
        .on('error', error);
        .on('connect', function ()
        {
            write_tokens(this, connected);
        });
};

