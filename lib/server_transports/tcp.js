/*eslint-env node */

/**
 * TCP transport. This allows messages to be sent over TCP connections.
 *
 * @module centro-js/lib/server_transports/tcp
 * @param {Object} config - Configuration options. This supports all the options supported by {@link https://nodejs.org/api/net.html#net_server_listen_options_callback|net.Server#listen}, {@link https://nodejs.org/api/net.html#net_net_createserver_options_connectionlistener|net.createServer} and {@link https://nodejs.org/api/tls.html#tls_tls_createserver_options_secureconnectionlistener|tls.createServer} as well as the following:
 * @param {net.Server|tls.Server} [config.server] - If you want to supply your own TCP or TLS server object. Otherwise, {@link https://nodejs.org/api/net.html#net_net_createserver_options_connectionlistener|net.createServer} or {@link https://nodejs.org/api/tls.html#tls_tls_createserver_options_secureconnectionlistener|tls.createServer} will be called to create one.
 * @param {boolean} [config.noDelay] - If present then {@link https://nodejs.org/api/net.html#net_socket_setnodelay_nodelay|setNoDelay} is called on every connection with this as the argument.
 * @param {Object} [config.tcp] - If present then this is used in preference to `config`.
 */
"use strict";

var net = require('net'),
    tls = require('tls');

module.exports = function (config, authorize, connected, ready, error, unused_warning)
{
    config = config.tcp || config;

    var certs = config.key && config.cert,
        server = config.server ||
                 (certs ? tls.createServer(config) : net.createServer(config)),
        evname = certs ? 'secureConnection' : 'connection';
    
    function connection(conn)
    {
        if (config.noDelay !== undefined)
        {
            conn.setNoDelay(config.noDelay);
        }

        function destroy()
        {
            conn.destroy();
        }

        function onclose(cb)
        {
            if (conn.destroyed)
            {
                return cb();
            }

            conn.on('close', cb);
        }

        authorize(conn, destroy, onclose, function (err, handshakes)
        {
            if (err)
            {
                return conn.destroy();
            }

            connected(handshakes, conn, destroy, onclose);
        });
    }

    server.on(evname, connection);
    server.on('error', error);

    function listening()
    {
        ready(null,
        {
            close: function (cb)
            {
                server.removeListener(evname, connection);
                server.removeListener('error', error);

                if (config.server)
                {
                    return cb();
                }
                
                server.close(cb);
            },

            server: server
        });
    }

    if (config.server)
    {
        return listening();
    }

    server.listen(config, listening);
};
