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
    cb(null, centro.stream_auth(net.createConnection(8700), config));
});
