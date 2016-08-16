"use strict";

var centro = require('..'),
    CentroServer = centro.CentroServer;

module.exports = function (config)
{
    var transport = config.transport;

    config.transport = require('../lib/transports/' + transport);
    config.authorize = require('authorize-jwt');
    config.db_type = 'pouchdb';

describe(transport, function ()
{
    var server;

    beforeEach(function (cb)
    {
        server = new centro.CentroServer(config);
        server.on('ready', cb);
    });
    
    afterEach(function (cb)
    {
        server.close(cb);
    });

    it('should publish and subscribe', function (done)
    {
        done();
    });
});
};
