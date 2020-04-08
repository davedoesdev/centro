/*eslint-env node */
/*eslint-disable no-console */
"use strict";

const centro = require('../../..');
const assert = require('assert');
const http2 = require('http2');

function display_message(s, info) {
    console.log('topic:', info.topic);
    s.pipe(process.stdout);
}

centro.separate_auth({
    token: process.env.CENTRO_TOKEN
}, function (err, userpass, make_client) {
    assert.ifError(err);
    http2.connect('http://localhost:8803', function () {
        this.request({
            ':method': 'POST', // <1>
            ':path': `/centro/v${centro.version}/http2`,
            Authorization: `Bearer ${userpass.split(':')[1]}` // <2>
        }).on('response', function (headers) {
            assert.equal(headers[':status'], 200);
            make_client(this).on('ready', function () {
                for (var topic of process.argv.slice(2)) {
                    this.subscribe(topic, display_message, assert.ifError);
                }
            });
        });
    });
});
