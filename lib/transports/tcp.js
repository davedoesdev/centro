var net = require('net');

module.exports = function (config, authorize, connected, ready, error, warning)
{
    config = config.tcp || config;

    var server = config.server || net.createServer(config),
        pending = new Set();
    
    server.on('connection', function (conn)
    {
        pending.add(conn);

        authorize(conn, function (err, handshakes)
        {
            if (!pending.delete(conn))
            {
                return;
            }

            if (err)
            {
                return conn.destroy();
            }

            connected(handshakes,
                      conn,
                      function ()
                      {
                          conn.destroy();
                      },
                      function (cb)
                      {
                          conn.on('close', cb);
                      });
        });
    });

    server.on('error', error);

    function listening()
    {
        ready(null,
        {
            close: function (cb)
            {
                for (var conn of pending)
                {
                    try
                    {
                        conn.destroy();
                    }
                    catch (ex)
                    {
                        warning(ex);
                    }
                }

                pending.clear();
                    
                if (server.listening === false)
                {
                    cb();
                }
                else
                {
                    server.close(cb);
                }
            }
        });
    }

    if (config.server)
    {
        if (server.listening === false)
        {
            server.once('listening', listening);
        }
        else
        {
            listening();
        }
    }
    else
    {
        server.listen(config, listening);
    }
};
