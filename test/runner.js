"use strict";

var centro = require('..'),
    CentroServer = centro.CentroServer,
    ursa = require('ursa'),
    jsjws = require('jsjws');

module.exports = function (config, connect)
{
    var transport = config.transport;

    config.transport = require('../lib/transports/' + transport);
    config.authorize = require('authorize-jwt');
    config.db_type = 'pouchdb';

describe(transport, function ()
{
    var server, client;

    beforeEach(function (cb)
    {
        server = new centro.CentroServer(config);
        server.on('ready', function ()
        {
            var token_exp = new Date(),
                header = { alg: 'PS256' },
                priv_key = ursa.generatePrivateKey(2048, 65537);

            token_exp.setMinutes(token_exp.getMinutes() + 1);

            var token = new jsjws.JWT().generateJWTByKey(header,
            {
            }, token_exp, priv_key);

            connect(
            {
                token: token
            }, function (err, c)
            {
                client = c;
                cb(err);
            });
        });
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
