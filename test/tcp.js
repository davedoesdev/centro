"use strict";

var net = require('net'),
    runner = require('./runner'),
    centro = require('..');

runner(
{
    transport: 'tcp',
    port: 8700
}, function (config, cb)
{
    net.createConnection(8700, function ()
    {
        centro.stream_auth(this, config);
    });
});
