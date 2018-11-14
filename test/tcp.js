/*eslint-env node, mocha */
"use strict";

var fs = require('fs'),
	path = require('path'),
    runner = require('./runner'),
    centro = require('..'),
    port = 8700;

function setup(mod, client_config, server_config)
{

function connect(config, server, cb)
{
    require(mod).connect(Object.assign(
    {
        port: port
    }, client_config), function ()
    {
        this.removeListener('error', cb);
        var conn_err = null;
        this.on('error', function (err)
        {
            conn_err = err;
        });
        this.setNoDelay(true);
        var c = centro.stream_auth(this, config);
        if (conn_err)
        {
            process.nextTick(function ()
            {
                c.emit('error', conn_err);
            });
        }
        cb(null, c);
    }).on('error', cb);
}

runner(
{
    transport: {
        server: 'tcp',
        config: Object.assign({
            port: port,
            noDelay: true
        }, server_config),
        name: mod
    }
}, connect);

runner(
{
    transport: {
        server: 'tcp',
        config: Object.assign({
            port: port
        }, server_config),
        name: mod + '_passed_in_server'
    }
}, connect,
{
    on_before: function (config, cb)
    {
        if (config.server)
        {
            return cb();
        }

        if (server_config)
        {
            config.server = require(mod).createServer(server_config);
        }
        else
        {
            config.server = require(mod).createServer();
        }

        config.server.listen(port, cb);
    },

    on_after: function (config, cb)
    {
        config.server.close(cb);
    }
});

}

setup('net');

setup('tls',
{
    ca: fs.readFileSync(path.join(__dirname, 'ca.pem'))
},
{
    key: fs.readFileSync(path.join(__dirname, 'server.key')),
    cert: fs.readFileSync(path.join(__dirname, 'server.pem'))
});

