/*eslint-env node */
"use strict";

const centro = require('../../..');
const assert = require('assert');
const http2 = require('http2');

centro.separate_auth({
    token: process.env.CENTRO_TOKEN
}, function (err, userpass, make_client) {
    assert.ifError(err);
    http2.connect('http://localhost:8803', function () {
        const session = this;
        this.request({
            ':method': 'POST',
            ':path': `/centro/v${centro.version}/http2`,
            Authorization: `Bearer ${userpass.split(':')[1]}`
        }).on('response', function (headers) {
            assert.equal(headers[':status'], 200);
            const stream = this;
            make_client(this).on('ready', function () {
                process.stdin.pipe(this.publish(process.argv[2], function (err) {
                    assert.ifError(err);
                    stream.end();
                    session.close();
                }));
            });
        });
    });
});
