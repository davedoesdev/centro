
const runner = require('./runner'),
      centro = require('..'),
      http2 = require('http2'),
      pathname = '/centro/v' + centro.version + '/http2',
      path = require('path'),
      fs = require('fs'),
      EventEmitter = require('events').EventEmitter,
      port = 8700;

function connect(config, server, cb)
{
    centro.separate_auth(config, function (err, userpass, make_client)
    {
        if (err)
        {
            return cb(err);
        }

        function connected()
        {
            config.test_config.http2_client_session
                .request({
                    ':method': 'POST',
                    ':path': pathname,
                    'Authorization': 'Bearer ' + userpass.split(':')[1]
                })
                .on('response', function (headers)
                {
                    if (headers[':status'] !== 200)
                    {
                        const bufs = [];

                        this.on('end', function ()
                        {
                            const msg = Buffer.concat(bufs).toString();
                            const client = new class extends EventEmitter {}();
                            client.mux = { carrier: this };
                            process.nextTick(() => {
                                client.emit('error', new Error(msg || 'closed'));
                            });
                            cb(null, client);
                        });

                        return this.on('readable', function ()
                        {
                            while (true)
                            {
                                const buf = this.read();
                                if (buf === null) { break; }
                                bufs.push(buf);
                            }
                        });
                    }
                    cb(null, make_client(this));
                });
        }

        if (config.test_config.http2_client_session &&
            !config.test_config.http2_client_session.closed)
        {
            return connected();
        }

        http2.connect(
            'https://localhost:' + port,
            {
                ca: fs.readFileSync(path.join(__dirname, 'ca.pem'))
            },
            function ()
            {
                config.test_config.http2_client_session = this;
                connected();
            });
    });
}

runner(
{
    transport: {
        server: 'http2',
        config: {
            port: port,
            key: fs.readFileSync(path.join(__dirname, 'server.key')),
            cert: fs.readFileSync(path.join(__dirname, 'server.pem'))
        },
        name: 'node_http2'
    }
}, connect);
