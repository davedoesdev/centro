/*eslint-env node */
/*eslint-disable no-console */
"use strict";

var centro = require('../../..');
var fs = require('fs');
var path = require('path');

var config = {
    allowed_algs: ['PS256'],
    auth_method: 'Basic',
    transports: [{
        server: 'tcp',
        config: { port: 8800 }
    }, {
        server: 'primus',
        config: { port: 8801 }
    }, {
        server: 'http',
        config: { port: 8802 }
    }, {
        server: 'http2',
        config: { port: 8803 }
    }, {
        server: 'http2-duplex',
        config: {
            port: 8804,
            key: fs.readFileSync(path.join(__dirname, '..', '..', 'server.key')),
            cert: fs.readFileSync(path.join(__dirname, '..', '..', 'server.pem'))
        }
    }, {
        server: 'in-mem',
        authorize_config: { ANONYMOUS_MODE: true }
    }]
};

var server = new centro.CentroServer(config);

server.on('ready', function ()
{
    console.log('READY.');
});
//----
var assert = require('assert');

server.on('ready', function ()
{
    this.transport_ops['in-mem'].connect(function (err, stream)
    {
        assert.ifError(err);

        centro.stream_auth(stream).subscribe('#', function (s, info)
        {
            console.log('topic:', info.topic);
            s.pipe(process.stdout);
        }, assert.ifError);
    });
});
