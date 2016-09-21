"use strict";

var runner = require('./runner'),
    centro = require('..'),
    Primus = require('primus'),
    Socket = Primus.createSocket(),
    PrimusDuplex = require('primus-backpressure').PrimusDuplex;

runner(
{
    transport: 'primus',
    port: 8700
}, function (config, server, cb)
{
    centro.separate_auth(config, function (err, userpass, make_client)
    {
        if (err)
        {
            return cb(err);
        }

        var socket = new Socket('http://' + userpass + '@localhost:8700',
        {
            strategy: false
        });

        cb(null, make_client(new PrimusDuplex(socket)));
    });
});
