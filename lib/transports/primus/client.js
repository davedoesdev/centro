
var Primus = require('primus.io'),
    PrimusDuplex = require('primus-backpressure').PrimusDuplex;

module.exports = function (config, write_tokens, connected, error)
{
    write_tokens(Object.assign({}, config), function (options)
    {
        var Socket = Primus.createSocket(config);
        new Socket(config.url, options)
            .on('error', error)
            .on('open', function ()
            {
                connected(new PrimusDuplex(this, config));
            });
    });
};

