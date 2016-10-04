"use strict";

var runner = require('./runner'),
    centro = require('..'),
    QlobberFSQ = require('qlobber-fsq').QlobberFSQ;

runner(
{
    transport: 'in-mem',
    transport_name: 'in-mem-fsq',
    fsq: new QlobberFSQ()
}, function (config, server, cb)
{
    server.transport_ops[0].connect(function (err, stream)
    {
        if (err)
        {
            return cb(err);
        }

        cb(null, centro.stream_auth(stream, config));
    });
},
{
});
