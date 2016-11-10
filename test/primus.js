"use strict";

var runner = require('./runner'),
    centro = require('..'),
    Primus = require('primus'),
    Socket = Primus.createSocket(
    {
        pathname: '/centro/v' + centro.version + '/primus'
    }),
    PrimusDuplex = require('primus-backpressure').PrimusDuplex;

function connect(config, server, cb)
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
}

runner(
{
    transport: 'primus',
    port: 8700
}, connect);

runner(
{
    transport: 'primus',
    transport_name: 'primus_passed_in_server'
}, connect,
{
    on_before: function (config, cb)
    {
        if (config.server)
        {
            return cb();
        }

        config.server = Primus.createServer(
        {
            pathname: '/centro/v' + centro.version + '/primus',
            port: 8700
        });

        config.server.on('initialised', cb);
    },

    on_after: function (config, cb)
    {
        config.server.destroy(config, cb);
    }
});
