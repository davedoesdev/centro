var centro = require('centro-js'),
    assert = require('assert'),
    Primus = require('primus'),
    Socket = Primus.createSocket(
    {
        pathname: '/centro/v' + centro.version + '/primus'
    }),
    PrimusDuplex = require('primus-backpressure').PrimusDuplex;

centro.separate_auth(
{
    token: process.env.CENTRO_TOKEN
}, function (err, userpass, make_client)
{
    assert.ifError(err);

    var socket = new Socket('http://' + userpass + '@localhost:8801',
                            { strategy: false }),
        duplex = new PrimusDuplex(socket);

    make_client(duplex).on('ready', function ()
    {
        this.subscribe(process.argv[2], function (s, info)
        {
            console.log('topic:', info.topic);
            s.pipe(process.stdout);
        }, assert.ifError);
    });
});
