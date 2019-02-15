/*eslint-env node */

/**
 * HTTP/2 transport for browsers. This allows messages to be sent over HTTP/2
 * streams to browsers.
 *
 * If your client isn't a browser, you should be able to use the
 * {@link centro-js/lib/server_transports/http2|http2} transport.
 *
 * This transport uses the {@link https://github.com/davedoesdev/browser-http2-duplex|http2-duplex} module to emulate a full-duplex connection with browsers.
 * Browser-to-server streaming isn't implemented by any browser, nor are there
 * any plans to do so. `http2-duplex` emulates it by using POST requests.
 *
 * @module centro-js/lib/server_transports/http2-duplex
 * @param {Object} config - Configuration options. This supports all the options supported by {@link https://nodejs.org/api/http2.html#http2_http2_createserver_options_onrequesthandler|http2.createServer}, {@link https://nodejs.org/api/http2.html#http2_http2_createsecureserver_options_onrequesthandler|http2.createSecureServer}, {@link https://nodejs.org/api/net.html#net_server_listen_options_callback|net.Server#listen} and {@link https://github.com/davedoesdev/browser-http2-duplex|http2-duplex} as well as the following:
 * @param {centro-js/lib/server_transports/http2-duplex.CentroHttp2DuplexServer} [config.server] - If you want to supply your own HTTP/2 full-duplex emulation server. This class inherits from `Http2DuplexServer` in {@link https://github.com/davedoesdev/browser-http2-duplex|http2-duplex}. If you don't supply an instance (the default) then one will be created for you, along with an instance of {@link https://nodejs.org/api/http2.html#http2_class_http2server|Http2Server} or {@link https://nodejs.org/api/http2.html#http2_class_http2secureserver|Http2SecureServer}.
 * @param {string} [config.pathname=/centro/v2/http2-duplex] - Pathname prefix on which to listen for requests.
 * @param {Object} [config.http2_duplex] - If present then this is used in preference to `config`.
 * @param {Object} [config.access] - Passed to {@link https://github.com/primus/access-control|access-control}.
 */
"use strict";

const { promisify } = require('util');
const http2 = require('http2');
const centro = require('../..');
const access = require('access-control');
const { Http2DuplexServer } = require('http2-duplex');

function on_close(stream, cb) {
    let called = false;

    function cb2() {
        if (!called) {
            called = true;
            cb();
        }
    }

    if (stream.closed) {
        return cb2();
    }
    stream.on('close', cb2);
    stream.on('aborted', cb2);
}

class CentroHttp2DuplexServer extends Http2DuplexServer {
    constructor(http2_server, options) {
        super(http2_server,
              options.pathname || `/centro/v${centro.version}/http2-duplex`,
              options);

        this.cors = access({
            methods: ['GET', 'POST', 'OPTIONS'],
            ...options.access
        });

        this.num_streams = 0;
    }

    init(authorize, connected, warning, cb) {
        super.attach();

        this.authorize = authorize;
        this.connected = connected;
        this.warning = warning;

        if (this.http2_server.listening) {
            return cb();
        }

        this.http2_server.listen(this.options, cb);
    }

    async process_session(session) {
        session.on('error', this.warning);
        await super.process_session(session);
    }

    async process_stream(stream, headers, flags, raw_headers,
                         duplexes, response_headers) {
        stream.on('error', this.warning);
        this.own_stream(stream);

        const req = new http2.Http2ServerRequest(stream, headers, undefined,
raw_headers);
        const res = new http2.Http2ServerResponse(stream);
        res[Symbol('outHeadersKey')] = {};
        if (this.cors(req, res)) {
            return true;
        }
        Object.assign(response_headers, res.getHeaders());

        const handled = await super.process_stream(
            stream, headers, flags, raw_headers, duplexes, response_headers);
        if (!handled) {
            stream.respond({
                ':status': 404,
                ...response_headers
            }, {
                endStream: true
            });
        }
        return handled;
    }

    async new_stream(stream, headers, flags, raw_headers,
                     duplexes, response_headers) {
        if (this.maxConnections && (this.num_streams >= this.maxConnections)) {
            return stream.respond({
                ':status': 503,
                ...response_headers
            }, {
                endStream: true
            }); 
        }

        ++this.num_streams;
        on_close(stream, () => {
            --this.num_streams;
        });

        stream.headers = headers;
        stream.url = headers[':path'];

        const authorize = done => {
            this.authorize(stream, function () {
                stream.respond({
                    ':status': 503,
                    ...response_headers
                }, {
                    endStream: true
                });
            }, cb => {
                on_close(stream, cb);
            }, async (err, handshakes, unused_tokens) => {
                if (err) {
                    stream.respond({
                        ':status': err.statusCode,
                        'WWW-Authenticate': err.authenticate,
                        ...response_headers
                    });
                    return stream.end(err.message);
                }

                const duplex = await super.new_stream(
                    stream, headers, flags, raw_headers,
                    duplexes, response_headers);

                const destroy = () => {
                    this.destroy(duplex);
                };

                duplex.on('end', destroy);
                duplex.on('finish', destroy);
                duplex.on('error', destroy);

                this.connected(handshakes,
                               duplex,
                               destroy,
                               function(cb) {
                                   on_close(duplex, cb)
                               });

                done(null, duplex);
            });
        };

        return await promisify(authorize)();
    }
}

module.exports = function (config, authorize, connected, ready, error, warning)
{
    config = config.http2_duplex || config;

    const certs = config.key && config.cert;
    const port = config.port || /* istanbul ignore next */ 443;
    const secure = certs || port === 443;
    const server = config.server ||
        new CentroHttp2DuplexServer(
            secure ? http2.createSecureServer(config) :
                     http2.createServer(config),
            config);

    server.http2_server.on('error', error);

    function listening() {
        ready(null, {
            close: function (cb) {
                server.http2_server.removeListener('error', error);
                server.detach();
                if (config.server) {
                    return cb();
                }
                server.http2_server.on('session', server.destroy.bind(server));
                server.http2_server.close(cb);
            },
            server: server
        });
    }

    server.init(authorize, connected, warning, listening);
};

module.exports.CentroHttp2DuplexServer = CentroHttp2DuplexServer;
