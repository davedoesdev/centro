var net = require('net');

module.exports = function (config, authorize, connected, ready, error, warning)
{
    config = config.tcp || config;

    var server = config.server || net.createServer(config);
    
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

    server.on('connection', connection);
    server.on('error', error);

    function listening()
    {
        ready(null,
        {
            close: function (cb)
            {
                server.removeListener('connection', connection);
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
