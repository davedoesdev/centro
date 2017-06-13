var net = require('net'),
    tls = require('tls');

module.exports = function (config, authorize, connected, ready, error, warning)
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
