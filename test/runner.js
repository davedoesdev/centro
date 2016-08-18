"use strict";

var centro = require('..'),
    CentroServer = centro.CentroServer,
    ursa = require('ursa'),
    jsjws = require('jsjws'),
	chai = require('chai'),
    expect = chai.expect,
    uri = 'mailto:dave@davedoesdev.com';

function read_all(s, cb)
{
    var bufs = [];

    s.on('end', function ()
    {
        if (cb)
        {
            cb(Buffer.concat(bufs));
        }
    });

    s.on('readable', function ()
    {
        while (true)
        {
            var data = this.read();
            if (data === null) { break; }
            bufs.push(data);
        }
    });
}

module.exports = function (config, connect)
{
    var transport = config.transport;

    config.transport = require('../lib/transports/' + transport);
    config.authorize = require('authorize-jwt');
    config.db_type = 'pouchdb';
    config.db_for_update = true;

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
                iss: issuer_id,
                subscriptions: [],
                access_control: {
                    publish: {
                        allow: ['foo'],
                        disallow: []
                    },
                    subscribe: {
                        allow: ['foo'],
                        disallow: []
                    }
                }
            }, token_exp, priv_key)
        }, function (err, c)
        {
            if (err)
            {
                return cb(err);
            }

            client = c;
            client.on('ready', cb);
        });
    });

    afterEach(function (cb)
    {
        client.mux.carrier.on('end', cb);
        client.mux.carrier.end();
    });
    
    it('should publish and subscribe', function (done)
    {
        client.subscribe('foo', function (s, info)
        {
            expect(info.topic).to.equal('foo');
            expect(info.single).to.equal(false);

            read_all(s, function (v)
            {
                expect(v.toString()).to.equal('bar');
                done();
            });
        });

        // what's the point of subscriptions in token?
        // we don't have the handler
        // but it would allow to subscribe but not unsubscribe
        // - need to remember in client in that case

        client.publish('foo').end('bar');
    });
});
};
