"use strict";

var centro = require('..'),
    CentroServer = centro.CentroServer,
    ursa = require('ursa'),
    jsjws = require('jsjws'),
    uri = 'mailto:dave@davedoesdev.com';

module.exports = function (config, connect)
{
    var transport = config.transport;

    config.transport = require('../lib/transports/' + transport);
    config.authorize = require('authorize-jwt');
    config.db_type = 'pouchdb';

describe(transport, function ()
{
    var server, client, priv_key, issuer_id, rev;

    before(function (cb)
    {
        server = new centro.CentroServer(config);
        server.on('ready', function ()
        {
            priv_key = ursa.generatePrivateKey(2048, 65537);
            server.authz.keystore.add_pub_key(uri, priv_key.toPublicPem('utf8'),
            function (err, the_issuer_id, the_rev)
            {
                if (err)
                {
                    return cb(err);
                }
                
                issuer_id = the_issuer_id;
                rev = the_rev;

                cb();
            });
        });
    });

    after(function (cb)
    {
        server.authz.keystore.remove_pub_key(uri, function (err)
        {
            if (err)
            {
                return cb(err);
            }

            server.close(cb);
        });
    });

    beforeEach(function (cb)
    {
        var token_exp = new Date();

        token_exp.setMinutes(token_exp.getMinutes() + 1);

        connect(
        {
            token: new jsjws.JWT().generateJWTByKey(
            {
                alg: 'PS256'
            },
            {
                iss: issuer_id
            }, token_exp, priv_key)
        }, function (err, c)
        {
            client = c;
            cb(err);
        });
    });

    afterEach(function (cb)
    {
        client.mux.carrier.on('end', cb);
        client.mux.carrier.end();
    });
    
    it('should publish and subscribe', function (done)
    {
        done();
    });
});
};
