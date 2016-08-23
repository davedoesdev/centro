/*jshint mocha: true */
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

        function setup(access_control, ack)
        {
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
                        access_control: access_control,
                        ack: ack
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
        }

        describe('simple access control', function ()
        {
            setup(
            {
                publish: {
                    allow: ['foo'],
                    disallow: []
                },
                subscribe: {
                    allow: ['foo'],
                    disallow: []
                }
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

                client.publish('foo').end('bar');
            });
        });

        describe('access control with self', function ()
        {
            setup(
            {
                publish: {
                    allow: ['direct.${self}.*.#',
                            'all.${self}.#'],
                    disallow: []
                },
                subscribe: {
                    allow: ['direct.*.${self}.#',
                            'all.*.#'],
                    disallow: []
                }
            });

            it('should publish and subscribe', function (done)
            {
                client.subscribe('all.*.foo', function (s, info)
                {
                    expect(info.topic).to.equal('all.${self}.foo');
                    expect(info.single).to.equal(false);

                    read_all(s, function (v)
                    {
                        expect(v.toString()).to.equal('bar');
                        done();
                    });
                });

                client.publish('all.${self}.foo').end('bar');
            });
        });

        describe('access control with self and ack', function ()
        {
            setup(
            {
                publish: {
                    allow: ['direct.${self}.*.#',
                            'all.${self}.#'],
                    disallow: []
                },
                subscribe: {
                    allow: ['direct.*.${self}.#',
                            'all.*.#',
                            'ack.*.all.${self}.#',
                            'ack.*.direct.${self}.*.#'],
                    disallow: []
                }
            },
            {
                prefix: 'ack.${self}'
            });
            
            it('should publish and subscribe', function (done)
            {
                client.subscribe('all.*.foo', function (s, info, ack)
                {
                    expect(info.topic).to.equal('all.${self}.foo');
                    expect(info.single).to.equal(true);

                    read_all(s, function (v)
                    {
                        expect(v.toString()).to.equal('bar');
                        ack();
                    });
                });

                client.subscribe('ack.*.all.${self}.foo', function (s, info)
                {
                    expect(info.topic).to.equal('ack.${self}.all.${self}.foo');
                    expect(info.single).to.equal(false);

                    done();
                });

                client.publish('all.${self}.foo', { single: true }).end('bar');
            });
        });
    });
};
