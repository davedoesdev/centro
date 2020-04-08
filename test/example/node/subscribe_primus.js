/*eslint-env node */
/*eslint-disable no-console */
"use strict";

const centro = require('../../..');
const assert = require('assert');
const Primus = require('primus');
const Socket = Primus.createSocket({
    pathname: '/centro/v' + centro.version + '/primus' // <1>
});
const PrimusDuplex = require('primus-backpressure').PrimusDuplex; // <2>

function display_message(s, info) {
    console.log('topic:', info.topic);
    s.pipe(process.stdout);
}

centro.separate_auth( { // <3>
    token: process.env.CENTRO_TOKEN
}, function (err, userpass, make_client) {
    assert.ifError(err);

    const socket = new Socket('http://' + userpass + '@localhost:8801', // <4>
                              { strategy: false }); // <5>
    const duplex = new PrimusDuplex(socket);

    make_client(duplex).on('ready', function () { // <6>
        for (const topic of process.argv.slice(2)) {
            this.subscribe(topic, display_message, assert.ifError);
        }
    });
});
