/*eslint-env node */
"use strict";

var runner = require('./runner'),
    centro = require('..'),
    QlobberPG = require('qlobber-pg').QlobberPG,
    cfg = require('config');

runner(
{
    transport: {
        server: 'in-mem',
        name: 'in-mem-pg'
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
            config.fsq = new QlobberPG(Object.assign(
            {
                name: 'test'
            }, cfg, config));
            config.fsq._queue.push(cb => config.fsq._client.query('DELETE FROM messages', cb));
        }

        cb();
    },

    on_before_each: function (config, cb)
    {
        config.fsq._reset_last_ids(cb);
    }
});
