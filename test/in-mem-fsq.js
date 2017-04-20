"use strict";

var runner = require('./runner'),
    centro = require('..'),
    QlobberFSQ = require('qlobber-fsq').QlobberFSQ;

runner(
{
    transport: {
        server: 'in-mem',
        name: 'in-mem-fsq'
    }
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
    on_before: function (config, cb)
    {
        if (!config.fsq)
        {
            config.fsq = new QlobberFSQ(config);
        }

        cb();
    }
});
