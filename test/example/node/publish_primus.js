/*eslint-env node */
"use strict";

const centro = require('../../..');
const assert = require('assert');
const Primus = require('primus');
const Socket = Primus.createSocket({
    pathname: '/centro/v' + centro.version + '/primus'
});
const PrimusDuplex = require('primus-backpressure').PrimusDuplex;

centro.separate_auth({
    token: process.env.CENTRO_TOKEN
}, function (err, userpass, make_client) {
    assert.ifError(err);

    const socket = new Socket('http://' + userpass + '@localhost:8801',
                              { strategy: false });
    const duplex = new PrimusDuplex(socket);

    make_client(duplex).on('ready', function () {
        process.stdin.pipe(this.publish(process.argv[2], function (err) {
            assert.ifError(err);
            duplex.end();
        }));
    });
});
