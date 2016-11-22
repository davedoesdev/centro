exports.Buffer = Buffer;
exports.stream = require('stream');
Object.assign(exports,
              require('./lib/client.js'),
              require('primus-backpressure'));
