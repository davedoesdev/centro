/*eslint-env node */

/**
 * HTTP/2 transport. This allows messages to be sent over HTTP/2 streams.
 *
 * Note that this transport won't work with browser clients. You'll need to use
 * the {@link centro-js/lib/server_transports/http2-duplex|http2-duplex}
 * transport with browsers.
 *
 * @module centro-js/lib/server_transports/http2
 * @param {Object} config - Configuration options. This supports all the options supported by {@link https://nodejs.org/api/http2.html#http2_http2_createserver_options_onrequesthandler|http2.createServer}, {@link https://nodejs.org/api/http2.html#http2_http2_createsecureserver_options_onrequesthandler|http2.createSecureServer} and {@link https://nodejs.org/api/net.html#net_server_listen_options_callback|net.Server#listen} as well as the following:
 * @param {http2.Http2Server|http2.Http2SecureServer} [config.server] - If you want to supply your own HTTP/2 server object. Otherwise, {@link https://nodejs.org/api/http2.html#http2_http2_createserver_options_onrequesthandler|http2.createServer} or {https://nodejs.org/api/http2.html#http2_http2_createsecureserver_options_onrequesthandler|http2.createSecureServer} will be called to create one.
 * @param {string} [config.pathname=/centro/v2/http2] - Pathname prefix on which to listen for requests.
 * @param {Object} [config.http2] - If present then this is used in preference to `config`.
 * @param {Object} [config.access] - Passed to {@link https://github.com/primus/access-control|access-control}.
 */
"use strict";

var http2 = require('http2'),
    centro = require('../..'),
    access = require('access-control');

const common_headers = {
    'Cache-Control': 'max-age=0, no-cache, must-revalidate, proxy-revalidate'
};

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
            methods: ['GET', 'POST', 'OPTIONS']
        }, config.access)),
        sessions = new Set(),
        num_streams = 0;

    function destroy_session(session)
    {
        try
        {
            session.destroy();
        }
        catch (ex)
        {
            /* istanbul ignore next */
            warning(ex);
        }
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
            }, function (err, handshakes, unused_tokens)
            {
                if (err)
                {
                    stream.respond(
                    {
                        ':status': err.statusCode,
                        'Content-Type': 'application/json',
                        'WWW-Authenticate': err.authenticate,
                        ...res.getHeaders(),
                        ...common_headers
                    });
                    return stream.end(JSON.stringify({ error: err.message }));
                }

                stream.respond(
                {
                    ':status': 200,
                    'Content-Type': 'application/octet-stream',
                    ...res.getHeaders(),
                    ...common_headers
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
                    session.removeAllListeners('stream');
                    destroy_session(session);
                }

                if (config.server)
                {
                    return cb();
                }

                server.on('session', destroy_session);
                //server.close(cb);
                console.log("XCLOSING");
                server.close(err => {
                    console.log("XCLOSED");
                    cb(err);
                });
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
