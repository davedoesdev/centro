/*eslint-env node */
"use strict";

var runner = require('./runner'),
    centro = require('..');

runner(
{
    transport: {
        server: 'in-mem',
        name: 'in-mem-shared'
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
    shared: true
});
