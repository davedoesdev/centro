
const runner = require('./runner'),
      centro = require('..'),
      http2 = require('http2'),
      expect = require('chai').expect,
      read_all = require('./read_all'),
      pathname = '/centro/v' + centro.version + '/http2',
      path = require('path'),
      fs = require('fs'),
      EventEmitter = require('events').EventEmitter,
      port = 8700;

function setup(client_config, server_config)
{
const scheme = client_config.ca ? 'https' : 'http';

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
                .request(
                {
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
            `${scheme}://localhost:${port}`, client_config, function ()
            {
                config.test_config.http2_client_session = this;
                connected();
            });
    });
}

function on_pre_after(config, cb)
{
    const session = config.http2_client_session;
    delete config.http2_client_session;

    if (session && !session.destroyed)
    {
        session.once('close', cb);
        return session.destroy();
    }

    cb();
}

function extra(get_info, on_before)
{
    let session;

    function on_bef(cb)
    {
        http2.connect(
            `${scheme}://localhost:${port}`, client_config, function ()
            {
                session = this;
                cb();
            });
    }
    before(on_bef);

    function on_aft(cb)
    {
        session.close(cb);
    }
    after(on_aft);

    it('should return 403 for invalid CORS request', function (done)
    {
        session.request(
        {
            ':method': 'POST',
            ':path': pathname,
            'origin': '%'
        })
        .on('response', function (headers)
        {
            expect(headers[':status']).to.equal(403);
            read_all(this, function (v)
            {
                expect(v.toString()).to.equal('Invalid HTTP Access Control (CORS) request:\n  Origin: %\n  Method: POST');
                done();
            });
        }).end();
    });

    it('should return 404 for unknown path', function (done)
    {
        session.request(
        {
            ':method': 'POST',
            ':path': '/dummy'
        })
        .on('response', function (headers)
        {
            expect(headers[':status']).to.equal(404);
            done();
        }).end();
    });

    it('should return 405 for GET request', function (done)
    {
        session.request(
        {
            ':method': 'GET',
            ':path': pathname
        })
        .on('response', function (headers)
        {
            expect(headers[':status']).to.equal(405);
            done();
        }).end();
    });
}

runner(
{
    transport: {
        server: 'http2',
        config: Object.assign(
        {
            port: port
        }, server_config),
        name: `node_http2_${scheme}`
    }
}, connect,
{
    extra: extra,
    on_pre_after: on_pre_after
});

runner(
{
    transport: {
        server: 'http2',
        config: Object.assign(
        {
            port: port
        }, server_config),
        name: `node_http2_${scheme}_passed_in_server`
    }
}, connect,
{
    extra: extra,

    on_before: function (config, cb)
    {
        if (config.server)
        {
            return cb();
        }

        if (server_config)
        {
            config.server = client_config.ca ?
                http2.createSecureServer(server_config) :
                http2.createServer(server_config);
        }
        else
        {
            config.server = client_config.ca ?
                http2.createSecureServer() :
                http2.createServer();
        }

        config.server.listen(port, cb);
    },

    on_pre_after: on_pre_after,

    on_after: function (config, cb)
    {
        config.server.on('session', function (session)
        {
            try
            {
                session.destroy();
            }
            catch (ex)
            {
            }
        });

        config.server.close(cb);
    }
});

}

setup({});

setup(
{
    ca: fs.readFileSync(path.join(__dirname, 'ca.pem'))
},
{
    key: fs.readFileSync(path.join(__dirname, 'server.key')),
    cert: fs.readFileSync(path.join(__dirname, 'server.pem'))
});
