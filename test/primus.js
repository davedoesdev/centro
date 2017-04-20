"use strict";

var runner = require('./runner'),
    centro = require('..'),
    Primus = require('primus'),
    Socket = Primus.createSocket(
    {
        pathname: '/centro/v' + centro.version + '/primus'
    }),
    PrimusDuplex = require('primus-backpressure').PrimusDuplex,
    path = require('path'),
    fs = require('fs'),
    port = 8700;

function setup(mod, transport_config, client_config, server_config)
{

function connect(config, server, cb)
{
    centro.separate_auth(config, function (err, userpass, make_client)
    {
        if (err)
        {
            return cb(err);
        }

        var socket = new Socket(
                mod + '://' + userpass + '@localhost:' + port,
                {
                    strategy: false,
                    transport: client_config
                }, client_config);

        cb(null, make_client(new PrimusDuplex(socket)));
    });
}

runner(
{
    transport: {
        server: 'primus',
        config: transport_config,
        name: 'primus_' + mod
    },
}, connect);

runner(
{
    transport: {
        server: 'primus',
        config: transport_config,
        name: 'primus_' + mod + '_passed_in_server'
    },
}, connect,
{
    on_before: function (config, cb)
    {
        if (config.server)
        {
            return cb();
        }

        config.server = Primus.createServer(Object.assign(
        {
            pathname: '/centro/v' + centro.version + '/primus',
            port: port
        }, server_config));

        config.server.on('initialised', cb);
    },

    on_after: function (config, cb)
    {
        config.server.destroy(config, cb);
    }
});

}

setup('http', { port: port });

setup('https',
{
    port: port,
    key: fs.readFileSync(path.join(__dirname, 'server.key')),
    cert: fs.readFileSync(path.join(__dirname, 'server.pem'))
},
{
    agent: new (require('https').Agent)(),
    ca: fs.readFileSync(path.join(__dirname, 'ca.pem'))
},
{
    key: fs.readFileSync(path.join(__dirname, 'server.key')),
    cert: fs.readFileSync(path.join(__dirname, 'server.pem'))
});
