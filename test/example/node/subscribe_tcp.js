/*eslint-env node */
/*eslint-disable no-console */
"use strict";

const centro = require('../../..');
const net = require('net');
const assert = require('assert');

function display_message(s, info) {
    console.log('topic:', info.topic); // <1>
    s.pipe(process.stdout); // <2>
}

net.createConnection(8800, function () { // <3>
    centro.stream_auth(this, { // <4>
        token: process.env.CENTRO_TOKEN // <5>
    }).on('ready', function () {
        for (const topic of process.argv.slice(2)) {
            this.subscribe(topic, display_message, assert.ifError);
        }
    });
});
