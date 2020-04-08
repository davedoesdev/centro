/*eslint-env node */
/*eslint-disable no-console */
"use strict";

const centro = require('../../..');
const fs = require('fs');
const path = require('path');

const config = {
    allowed_algs: ['EdDSA'], // <1>
    auth_method: 'Basic', // <2>
    transports: [{
        server: 'tcp',
        config: { port: 8800 }
    }, {
        server: 'primus',
        config: { port: 8801 }
    }, {
        server: 'http',
        config: { port: 8802 }
    }, {
        server: 'http2',
        config: { port: 8803 }
    }, {
        server: 'http2-duplex',
        config: {
            port: 8804,
            key: fs.readFileSync(path.join(__dirname, '..', '..', 'server.key')), // <3>
            cert: fs.readFileSync(path.join(__dirname, '..', '..', 'server.pem'))
        }
    }, {
        server: 'in-mem',
        config: {
            allowed_algs: ['HS256'], // <4>
            privileged: true // <5>
        }
    }]
};

const server = new centro.CentroServer(config); // <6>

server.on('ready', () => console.log('READY.'));
//----
const assert = require('assert');
const { JWK, JWT } = require('jose');

server.on('ready', function () {
    const ops = this.transport_ops['in-mem']; // <1>
    const key = JWK.generateSync('oct'); // <2>
    ops.authz.keystore.add_pub_key('test', key, function (err, issuer) { // <3>
        assert.ifError(err);

        const token = JWT.sign({ // <4>
            access_control: { // <5>
                subscribe: { allow: ['#'], disallow: [] },
                publish: { allow: ['#'], disallow: [] }
            }
        }, key, {
            algorithm: 'HS256',
            issuer
        });

        ops.connect(function (err, stream) { // <6>
            assert.ifError(err);

            centro.stream_auth(stream, {
                token
            }).on('ready', function () {
                this.subscribe('#', function (s, info) {
                    console.log('topic:', info.topic);
                    s.pipe(process.stdout);
                }, assert.ifError);
            });
        });
    });
});
