var uri = 'http://davedoesdev.com',
    CentroServer = require('centro').CentroServer,
    assert = require('assert'),
    jsjws = require('jsjws');

new CentroServer(
{
    authorize: require('authorize-jwt'),
    db_type: 'pouchdb',
    transport: CentroServer.load_transport(process.argv[2] || 'tcp'),
    port: 8800
}).on('ready', function ()
{
    console.log('READY.');
});
