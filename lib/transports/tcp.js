var net = require('net');

exports.server = function (config, authorize, connected)
{
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
                      });
        });
    });
};
