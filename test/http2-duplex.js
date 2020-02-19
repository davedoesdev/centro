/*eslint-env node, mocha, browser */
"use strict";
const runner = require('./runner');
const centro = require('..');
const { CentroHttp2DuplexServer } = centro.CentroServer.load_transport('http2-duplex');
const { promisify } = require('util');
const http2 = require('http2');
const http2_duplex_client = require('http2-duplex/client_cjs.js');
const make_client_http2_duplex = http2_duplex_client.default;
const ResponseError = http2_duplex_client.ResponseError;
const { expect } = require('chai');
const read_all = require('./read_all');
const pathname = `/centro/v${centro.version}/http2-duplex`;
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
let fetch2;
function new_fetch2(config, cb) {
    ({ fetch: fetch2 } = require('fetch-h2').context({
        session: {
            ca: fs.readFileSync(path.join(__dirname, 'ca.pem'))
        }
    }));
    if (cb) {
        cb();
    }
}
const port = 8700;

global.fetch = async function(url, options) {
    if (options && options.body && (options.body instanceof Uint8Array)) {
        options = {
            ...options,
            body: Buffer.from(options.body)
        };
    }
    let url2 = url.replace('http:', 'http2:');
    const response = await fetch2(url2, options);
    let readable = null;
    response.body = {
        getReader() {
            return {
                async read() {
                    if (!readable) {
                        readable = await response.readable(); // eslint-disable-line require-atomic-updates
                    }
                    return await promisify(function (cb) {
                        function cb2(err, r) {
                            readable.pause();
                            readable.removeListener('end', on_end);
                            readable.removeListener('close', on_end);
                            readable.removeListener('error', on_error);
                            readable.removeListener('data', on_data);
                            cb(err, r);
                        }

                        function on_end() {
                            cb2(null, { done: true });
                        }

                        function on_error(err) {
                            cb2(err);
                        }

                        function on_data(data) {
                            cb2(null, { done: false, value: data });
                        }

                        readable.on('end', on_end);
                        readable.on('close', on_end);
                        readable.on('error', on_error);
                        readable.on('data', on_data);
                        readable.resume();
                    })();
                }
            };
        }
    };
    return response;
};

function setup(scheme, server_config) {

function connect(config, server, cb) {
    server.once('authz_start', function (cancel, onclose, stream) {
        stream.on('close', () => {
            onclose(() => {}); // adds coverage to onclose when already closed
        });
    });

    centro.separate_auth(config, async function (err, userpass, make_client) {
        if (err) {
            return cb(err);
        }

        async function really_connect() {
            let duplex;
            try {
                duplex = await make_client_http2_duplex(
                    `${scheme}://localhost:${port}${pathname}`, {
                        headers: {
                            'Authorization': 'Bearer ' + userpass.split(':')[1]
                        }
                    });
            } catch (ex) {
                if (ex instanceof ResponseError) {
                    return read_all(await ex.response.readable(), function (buf) {
                        const msg = buf.toString();
                        const client = new class extends EventEmitter {}();
                        client.mux = { carrier: this };
                        process.nextTick(() => {
                            client.emit('error', new Error(msg ? JSON.parse(msg).error : 'closed'));
                        });
                        cb(null, client);
                    });
                }
                if (ex.message === 'Stream closed with error code NGHTTP2_ENHANCE_YOUR_CALM') {
                    // On Windows, Node marks session with NGHTTP2_ENHANCE_YOUR_CALM quite readily.
                    // Use a new session to work around this.
                    console.error(ex);
                    new_fetch2();
                    return setImmediate(really_connect);
                }
                return cb(ex);
            }

            duplex.on('error', async function (err) {
                if (err.message === 'Stream closed with error code NGHTTP2_REFUSED_STREAM') {
                    this.destroy();
                }
            });

            cb(null, make_client(duplex));
        }

        really_connect();
    });
}

function extra(unused_get_info) {
    it('should return 403 for invalid CORS request', async function() {
        const orig_includes = Array.prototype.includes;
        Array.prototype.includes = function (name) {
            if (name === 'origin') {
                return false;
            }
            return orig_includes.apply(this, arguments);
        };
        const response = await fetch(
            `${scheme}://localhost:${port}${pathname}`, {
                method: 'POST',
                headers: {
                    'origin': '%'
                }
            });
        Array.prototype.includes = orig_includes; // eslint-disable-line require-atomic-updates
        expect(response.ok).to.be.false;
        expect(response.status).to.equal(403);
        expect(await response.text()).to.equal('Invalid HTTP Access Control (CORS) request:\n  Origin: %\n  Method: POST');
    });

    it('should return 404 for unknown path', async function () {
        const response = await fetch(
            `${scheme}://localhost:${port}/dummy`, {
                method: 'POST'
            });
        expect(response.ok).to.be.false;
        expect(response.status).to.equal(404);
    });
}

runner({
    transport: {
        server: 'http2-duplex',
        config: {
            port: port,
            ...server_config
        },
        name: `node_http2-duplex_${scheme}`
    }
}, connect, {
    extra: extra,
    on_before: new_fetch2
});

runner({
    transport: {
        server: 'http2-duplex',
        config: { port, ...server_config },
        name: `node_http2-duplex_${scheme}_passed_in_server`
    }
}, connect, {
    extra: extra,

    on_before: function (config, cb) {
        new_fetch2();

        if (config.server) {
            return cb();
        }

        if (server_config) {
            config.server = new CentroHttp2DuplexServer(
                scheme === 'https' ?
                    http2.createSecureServer(server_config) :
                    http2.createServer(server_config),
                { port, ...server_config });
        } else {
            config.server = new CentroHttp2DuplexServer(
                scheme === 'https' ?
                    http2.createSecureServer() :
                    http2.createServer(),
                { port });
        }

        config.server.http2_server.on('session', function (session) {
            if (this.listenerCount('session') === 1) {
                // We've detached from the http2_server so destroy the new
                // session, otherwise the client's request (and subsequent ones
                // due to fetch-h2 re-using the same session) is never handled.
                try {
                    session.destroy();
                } catch (ex) {} // eslint-disable-line no-empty
            }
        });

        cb();
    },

    on_after: function (config, cb) {
        config.server.detach();
        config.server.http2_server.close(cb);
    }
});

}

setup('http');

setup('https', {
    key: fs.readFileSync(path.join(__dirname, 'server.key')),
    cert: fs.readFileSync(path.join(__dirname, 'server.pem'))
});
