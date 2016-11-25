exports.Buffer = Buffer;
exports.stream = require('stream');
exports.read_all = require('./test/read_all.js');
Object.assign(exports,
              require('./lib/client.js'),
              require('primus-backpressure'));
