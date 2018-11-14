/*eslint-env node */
"use strict";

var centro = require('../../..'),
    net = require('net'),
    assert = require('assert');

net.createConnection(8800, function ()
{
    var conn = this;

    centro.stream_auth(conn,
    {
        token: process.env.CENTRO_TOKEN
    }).on('ready', function ()
    {
        process.stdin.pipe(this.publish(process.argv[2], function (err)
        {
            assert.ifError(err);
            conn.end();
        }));
    });
});
