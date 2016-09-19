var net = require('net');

module.exports = function (config, authorize, connected, ready, error, warning)
{
    config = config.tcp || config;

    var server = config.server || net.createServer(config);
    
    server.on('connection', function (conn)
    {
        authorize(conn, function (err, handshakes)
        {
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
