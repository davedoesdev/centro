/*eslint-env node */
"use strict";

const centro = require('../../..');
const net = require('net');
const assert = require('assert');

net.createConnection(8800, function () {
    var conn = this;

    centro.stream_auth(conn, {
        token: process.env.CENTRO_TOKEN
    }).on('ready', function () {
        process.stdin.pipe(this.publish(process.argv[2], function (err) { // 1 2
            assert.ifError(err);
            conn.end(); // 3
        }));
    });
});
