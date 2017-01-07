var uri = 'http://davedoesdev.com',
    CentroServer = require('centro').CentroServer,
    assert = require('assert'),
    jsjws = require('jsjws'),
    base_port = 8800;

var config = {
    allowed_algs: ['PS256'],
    transport: []
};

for (var i = 2; i < process.argv.length; i += 1)
{
    config.transport.push(
    {
        server: CentroServer.load_transport(process.argv[i]),
        config: {
            port: base_port + i - 2
        }
    });
}

new CentroServer(config).on('ready', function ()
{
    console.log('READY.');
});
