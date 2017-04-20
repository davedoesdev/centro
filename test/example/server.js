var centro = require('centro-js'),
    assert = require('assert'),
    jsjws = require('jsjws');

var config = {
    allowed_algs: ['PS256'],
    transports: [{
        server: 'tcp',
        config: {
            port: 8800
        }
    }, {
        server: 'primus',
        config: {
            port: 8801
        }
    }, {
        server: 'http',
        config: {
            port: 8802
        }
    }, {
        server: 'in-mem',
        authorize_config: {
            ANONYMOUS_MODE: true
        },
    }]
};

new centro.CentroServer(config).on('ready', function ()
{
    this.transport_ops['in-mem'].connect(function (err, stream)
    {
        assert.ifError(err);

        centro.stream_auth(stream).subscribe('#', function (s, info)
        {
            console.log('topic:', info.topic);
            s.pipe(process.stdout);
        }, assert.ifError);

        console.log('READY.');
    });
});
