"use strict";

var runner = require('./runner'),
    centro = require('..');

runner(
{
    transport: {
        server: 'in-mem',
        authorize_config: {
            ANONYMOUS_MODE: true
        },
    },
    transport_name: 'embedded'
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
    anon: true
});
