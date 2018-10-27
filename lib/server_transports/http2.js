var http2 = require('http2'),
    centro = require('../..'),
    access = require('access-control');

const common_headers = {
    'Cache-Control': 'max-age=0, no-cache, must-revalidate, proxy-revalidate'
};

module.exports = function (config, authorize, connected, ready, error, warning)
{
    config = config.http2 || config;

    var certs = config.key && config.cert,
        port = config.port || /* istanbul ignore next */ 443,
        secure = certs || port === 443,
        server = config.server || 
                 (secure ? http2.createSecureServer(config) :
                           http2.createServer(config)),
        pathname = config.pathname || ('/centro/v' + centro.version + '/http2'),
        cors = access(Object.assign(
        {
            methods: ['POST', 'OPTIONS']
        }, config.access)),
        sessions = new Set(),
        num_streams = 0;
        // TODO: Middleware so can share port?

    function on_close(stream, cb)
    {
        let called = false;

        function cb2()
        {
            if (!called)
            {
                called = true;
                cb();
            }
        }

        if (stream.closed)
        {
            return cb2();
        }
        stream.on('close', cb2);
        stream.on('aborted', cb2);
    }

    function on_session(session)
    {
        session.on('error', warning);

        sessions.add(session);
        session.on('close', function ()
        {
            sessions.delete(this);
        });

        session.on('stream', function (stream, headers, flags, rawHeaders)
        {
            stream.on('error', warning);

            const req = new http2.Http2ServerRequest(stream, headers, undefined, rawHeaders);
            const res = new http2.Http2ServerResponse(stream);
            if (cors(req, res))
            {
                return;
            }

            if (headers[':path'] !== pathname)
            {
                return stream.respond(
                {
                    ':status': 404,
                    ...res.getHeaders(),
                    ...common_headers
                },
                {
                    endStream: true
                });
            }

            if (headers[':method'] !== 'POST')
            {
                return stream.respond(
                {
                    ':status': 405,
                    ...res.getHeaders(),
                    ...common_headers
                },
                {
                    endStream: true
                });
            }

            if (server.maxConnections && (num_streams >= server.maxConnections))
            {
                return stream.respond(
                {
                    ':status': 503,
                    ...res.getHeaders(),
                    ...common_headers
                },
                {
                    endStream: true
                });
            }

            ++num_streams;
            on_close(stream, function ()
            {
                --num_streams;
            });

            stream.headers = headers;
            stream.url = headers[':path'];

            stream.on('end', function ()
            {
                this.end();
            });

            authorize(stream, function ()
            {
                stream.respond(
                {
                    ':status': 503,
                    ...res.getHeaders(),
                    ...common_headers
                },
                {
                    endStream: true
                });
            }, function(cb)
            {
                on_close(stream, cb);
            }, function (err, handshakes, tokens)
            {
                if (err)
                {
                    stream.respond(
                    {
                        ':status': err.statusCode,
                        'WWW-Authenticate': err.authenticate,
                        ...res.getHeaders(),
                        ...common_headers
                    });
                    return stream.end(err.message);
                }

                stream.respond(
                {
                    ':status': 200,
                    'Content-Type': 'application/octet-stream',
                    ...res.getHeaders()
                });

                connected(handshakes,
                          stream,
                          function ()
                          {
                              stream.close();
                          },
                          function (cb)
                          {
                              on_close(stream, cb);
                          });
            });
        });
    }

    server.on('session', on_session);
    server.on('error', error);

    function listening()
    {
        ready(null,
        {
            close: function (cb)
            {
                server.removeListener('session', on_session);
                server.removeListener('error', error);

                for (let session of sessions)
                {
                    try
                    {
                        session.destroy();
                    }
                    catch (ex)
                    {
                        warning(ex);
                    }
                }

                if (config.server)
                {
                    return cb();
                }

                server.close(cb);
            },

            server: server,
            pathname: pathname
        });
    }

    if (config.server)
    {
        return listening();
    }

    server.listen(config, listening);
};
