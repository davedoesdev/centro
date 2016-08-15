var net = require('net');

exports.server = function (config, authorize, connected, ready, error)
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

    server.listen(config, ready);
    server.on('error', error);
};
