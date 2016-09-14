/*jshint mocha: true */
"use strict";

var centro = require('..'),
    CentroServer = centro.CentroServer,
    ursa = require('ursa'),
    jsjws = require('jsjws'),
    expect = require('chai').expect,
    async = require('async'),
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

module.exports = function (config, connect, options)
{
    options = options || {};

    var name;

    if (typeof config.transport === 'string' ||
        typeof config.transport[Symbol.iterator] !== 'function')
    {
        name = config.transport_name ||
               config.transport.server ||
               config.transport;

        if (config.transport.server)
        {
            config.transport.server = require('../lib/transports/' +
                                              config.transport.server);
        }
        else
        {
            config.transport = require('../lib/transports/' +
                                       config.transport);
        }
    }
    else
    {
        name = config.transport_name ||
               config.transport[0].server ||
               config.transport[0];

        for (var i = 0; i < config.transport.length; i += 1)
        {
            if (config.transport[i].server)
            {
                config.transport[i].server = require('../lib/transports/' +
                                                     config.transport[i].server);
            }
            else
            {
                config.transport[i] = require('../lib/transports/' +
                                              config.transport[i]);
            }
        }
    }

    config.authorize = require('authorize-jwt');
    config.db_type = 'pouchdb';
    config.db_for_update = true;

    describe(name, function ()
    {
        var server, clients, priv_key, issuer_id, rev,
            connections = new Map();

        before(function (cb)
        {
            server = new centro.CentroServer(config);

            server.on('connect', function (info)
            {
                connections.set(info.mqserver, info);
            });

            server.on('disconnect', function (mqserver)
            {
                connections.delete(mqserver);
            });

            server.on('ready', function ()
            {
                if (options.anon)
                {
                    return cb();
                }

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
            if (options.anon)
            {
                return cb();
            }

            server.authz.keystore.remove_pub_key(uri, function (err)
            {
                if (err)
                {
                    return cb(err);
                }

                server.close(cb);
            });
        });

        function setup(n, access_control, ack, presence)
        {
            beforeEach(function (cb)
            {
                expect(connections.size).to.equal(0);

                clients = [];
                var connected = 0;

                server.on('connect', function onconnect()
                {
                    connected += 1;
                    if (connected === n)
                    {
                        server.removeListener('connect', onconnect);
                        if (clients.length === n)
                        {
                            cb();
                        }
                    }
                });

                var token_exp = new Date();
                token_exp.setMinutes(token_exp.getMinutes() + 1);

                async.times(n, function (i, next)
                {
                    connect(
                    {
                        token: new jsjws.JWT().generateJWTByKey(
                        {
                            alg: 'PS256'
                        },
                        {
                            iss: issuer_id,
                            access_control: access_control,
                            ack: ack,
                            presence: presence
                        }, token_exp, priv_key)
                    }, server, function (err, c)
                    {
                        if (err)
                        {
                            return next(err);
                        }

                        c.on('ready', function ()
                        {
                            next(null, this);
                        });
                    });
                }, function (err, cs)
                {
                    if (err)
                    {
                        return cb(err);
                    }

                    clients = cs;
                    if (connected === n)
                    {
                        cb();
                    }
                });
            });

            afterEach(function (cb)
            {
                async.each(clients, function (c, cb)
                {
                    if (c.mux.carrier._readableState.ended)
                    {
                        return cb();
                    }
                    c.mux.carrier.on('end', cb);
                    c.mux.carrier.end();
                }, cb);
            });
        }

        describe('simple access control', function ()
        {
            setup(1,
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
                clients[0].subscribe('foo', function (s, info)
                {
                    expect(info.topic).to.equal('foo');
                    expect(info.single).to.equal(false);

                    read_all(s, function (v)
                    {
                        expect(v.toString()).to.equal('bar');
                        done();
                    });
                });

                clients[0].publish('foo').end('bar');
            });
        });

        describe('access control with block', function ()
        {
            setup(1,
            {
                publish: {
                    allow: ['foo.#'],
                    disallow: []
                },
                subscribe: {
                    allow: ['foo.#'],
                    disallow: []
                },
                block: ['foo.bar']
            });

            it('should block message', function (done)
            {
                var blocked = 0;

                for (var info of connections.values())
                {
                    info.access_control.on('message_blocked',
                    function (topic, mqserver)
                    {
                        expect(topic).to.equal(info.prefixes[0] + 'foo.bar');
                        expect(mqserver).to.equal(info.mqserver);
                        blocked += 1;
                        if (blocked === connections.size)
                        {
                            setTimeout(done, 1000);
                        }
                        else if (blocked > connections.size)
                        {
                            done(new Error('called too many times'));
                        }
                    });
                }
                
                clients[0].subscribe('foo.bar', function (s, info)
                {
                    done(new Error('should not be called'));
                });

                clients[0].subscribe('foo', function (s, info)
                {
                    expect(info.topic).to.equal('foo');
                    expect(info.single).to.equal(false);

                    read_all(s, function (v)
                    {
                        expect(v.toString()).to.equal('bar');
                        clients[0].publish('foo.bar').end('foobar');
                    });
                });

                clients[0].publish('foo').end('bar');
            });
        });

        describe('access control with self', function ()
        {
            setup(1,
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
                clients[0].subscribe('all.*.foo', function (s, info)
                {
                    if (!options.relay)
                    {
                        expect(info.topic).to.equal('all.${self}.foo');
                    }

                    expect(info.single).to.equal(false);

                    read_all(s, function (v)
                    {
                        expect(v.toString()).to.equal('bar');
                        done();
                    });
                });

                clients[0].publish('all.${self}.foo').end('bar');
            });
        });

        describe('access control with self and ack', function ()
        {
            setup(1,
            {
                publish: {
                    allow: ['direct.${self}.*.#',
                            'all.${self}.#'],
                    disallow: []
                },
                subscribe: {
                    allow: ['direct.*.${self}.#',
                            'all.*.#',
                            options.relay ? 'ack.*.all.*.#' :
                                            'ack.*.all.${self}.#',
                            'ack.*.direct.${self}.*.#'],
                    disallow: []
                }
            },
            {
                prefix: 'ack.${self}.'
            });
            
            it('should publish and subscribe', function (done)
            {
                clients[0].subscribe('all.*.foo', function (s, info, ack)
                {
                    if (!options.relay)
                    {
                        expect(info.topic).to.equal('all.${self}.foo');
                    }

                    expect(info.single).to.equal(true);

                    read_all(s, function (v)
                    {
                        expect(v.toString()).to.equal('bar');
                        ack();
                    });
                });

                clients[0].subscribe(options.relay ? 'ack.*.all.*.foo' :
                                                     'ack.*.all.${self}.foo',
                function (s, info)
                {
                    if (!options.relay)
                    {
                        expect(info.topic).to.equal('ack.${self}.all.${self}.foo');
                    }

                    expect(info.single).to.equal(false);

                    done();
                });

                clients[0].publish('all.${self}.foo', { single: true }).end('bar');
            });
        });

        describe('access control with self and presence', function ()
        {
            setup(2,
            {
                publish: {
                    allow: ['direct.${self}.*.#',
                            'all.${self}.#',
                            'join.direct.${self}.*',
                            'join.all.${self}'],
                    disallow: []
                },
                subscribe: {
                    allow: ['direct.*.${self}.#',
                            'all.*.#',
                            'join.direct.*.${self}',
                            'join.all.*',
                            'leave.all.*'],
                    disallow: []
                }
            },
            undefined,
            {
                connect: {
                    prefix: 'join.',
                    data: 'someone joined'
                },
                disconnect: {
                    topic: 'leave.all.${self}',
                    data: 'someone left'
                }
            });
            
            it('should support presence', function (done)
            {
                clients[0].subscribe('join.all.*', function (s, info)
                {
                    if (!options.relay)
                    {
                        expect(info.topic).to.equal('join.all.${self}');
                    }

                    expect(info.single).to.equal(false);

                    read_all(s, function (v)
                    {
                        expect(v.toString()).to.equal('"someone joined"');
                    });
                });

                clients[1].subscribe('leave.all.*', function (s, info)
                {
                    if (!options.relay)
                    {
                        expect(info.topic).to.equal('leave.all.' + clients[0].self);
                    }

                    expect(info.single).to.equal(false);

                    read_all(s, function (v)
                    {
                        expect(v.toString()).to.equal('"someone left"');
                        clients[1].unsubscribe('leave.all.*');
                        done();
                    });
                });

                clients[1].subscribe('join.all.*', function (s, info)
                {
                    if (!options.relay)
                    {
                        expect(info.topic).to.equal('join.all.' + clients[0].self);
                    }

                    expect(info.single).to.equal(false);

                    read_all(s, function (v)
                    {
                        expect(v.toString()).to.equal('"someone joined"');
                        clients[0].mux.carrier.end();
                    });
                });

                clients[0].publish('join.all.${self}').end('bar');
            });
        });
    });
};
