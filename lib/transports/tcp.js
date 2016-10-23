var net = require('net');

module.exports = function (config, authorize, connected, ready, error, warning)
{
    config = config.tcp || config;

    var server = config.server || net.createServer(config);
    
    function connection(conn)
    {
        authorize(conn, function ()
        {
            conn.destroy();
        }, function (err, handshakes)
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
                          if (conn.destroyed)
                          {
                              return cb();
                          }
                          conn.on('close', cb);
                      });
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
            }
        });
    }

    if (config.server)
    {
        return listening();
    }

    server.listen(config, listening);
};
