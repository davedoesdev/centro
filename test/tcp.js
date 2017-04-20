"use strict";

var net = require('net'),
    runner = require('./runner'),
    centro = require('..');

function connect(config, server, cb)
{
    net.createConnection(8700, function ()
    {
        this.setNoDelay(true);
        cb(null, centro.stream_auth(this, config));
    });
}

runner(
{
    transport: 'tcp',
    port: 8700,
    noDelay: true
}, connect);

runner(
{
    transport: {
        server: 'tcp',
        name: 'tcp_passed_in_server'
    }
}, connect,
{
    on_before: function (config, cb)
    {
        if (config.server)
        {
            return cb();
        }

        config.server = net.createServer();
        config.server.listen(8700, cb);
    },

    on_after: function (config, cb)
    {
        config.server.close(cb);
    }
});
