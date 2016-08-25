"use strict";

var net = require('net'),
    runner = require('./runner'),
    centro = require('..');

runner(
{
    transport: 'tcp',
    port: 8700
}, function (config, server, cb)
{
    net.createConnection(8700, function ()
    {
        cb(null, centro.stream_auth(this, config));
    });
});
