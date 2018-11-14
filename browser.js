/*eslint-env node */
"use strict";

exports.Buffer = Buffer;
exports.stream = require('stream');
exports.read_all = require('./test/read_all.js');
exports.make_client_http2_duplex = require('http2-duplex').default;
exports.ResponseError = require('http2-duplex').ResponseError;
Object.assign(exports,
              require('./lib/client.js'),
              require('primus-backpressure'));
