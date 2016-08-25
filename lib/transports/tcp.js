var net = require('net');

module.exports = function (config, authorize, connected, ready, error)
{
    var server = net.createServer(config);

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

    server.listen(config, function ()
    {
        ready(null,
        {
            close: function (cb)
            {
                server.close(cb);
            }
        });
    });

    server.on('error', error);
};
