var centro = require('centro-js'),
    net = require('net'),
    assert = require('assert');

net.createConnection(8800, function ()
{
    centro.stream_auth(this,
    {
        token: process.env.CENTRO_TOKEN
    }).on('ready', function ()
    {
        this.subscribe(process.argv[2], function (s, info)
        {
            s.pipe(process.stdout);
        }, assert.ifError);
    });
});
