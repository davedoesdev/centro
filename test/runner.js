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

                server.close(function ()
                {
                    expect(server.fsq._stopped).to.equal(true);
                    cb();
                });
            });
        });

        function setup(n, options)
        {
            beforeEach(function (cb)
            {
                expect(connections.size).to.equal(0);

                clients = [];
                var connected = 0;

                function onconnect()
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
                };

                server.on('connect', onconnect);

                var token_exp = new Date();
                token_exp.setMinutes(token_exp.getMinutes() + 1);

                async.times(n, function (i, next)
                {
                    var token = new jsjws.JWT().generateJWTByKey(
                    {
                        alg: 'PS256'
                    },
                    {
                        iss: issuer_id,
                        access_control: options.access_control,
                        ack: options.ack,
                        presence: options.presence
                    }, token_exp, priv_key)

                    connect(
                    {
                        token: i % 2 === 0 ? token : [token]
                    }, server, function (err, c)
                    {
                        if (err)
                        {
                            return next(err);
                        }

                        if (options.client_function)
                        {
                            options.client_function(c, onconnect);
                        }

                        if (options.skip_ready)
                        {
                            return next(null, c);
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
                var called = false;

                function empty()
                {
                    expect(server._connections.size).to.equal(0);
                    expect(server._connids.size).to.equal(0);
                    expect(connections.size).to.equal(0);

                    if (!called)
                    {
                        called = true;
                        cb();
                    }
                }

                server.once('empty', empty);

                async.each(clients, function (c, cb)
                {
                    if (c.mux.carrier._readableState.ended)
                    {
                        return cb();
                    }
                    c.mux.carrier.on('end', cb);
                    c.mux.carrier.end();
                }, function ()
                {
                    if (server._connids.size === 0)
                    {
                        empty();
                    }
                });
            });
        }

        describe('simple access control', function ()
        {
            setup(1,
            {
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
                }, function (err)
                {
                    if (err) { return done(err); }
                    clients[0].publish('foo').end('bar');
                });
            });

            it('emit publish_requested and subscribe_requested events', function (done)
            {
                var pubreq = false,
                    subreq = false;

                function regreq(mqserver)
                {
                    mqserver.on('publish_requested', function (topic, stream, options, cb)
                    {
                        pubreq = true;
                        stream.pipe(this.fsq.publish(topic, options, cb));
                    });

                    mqserver.on('subscribe_requested', function (topic, cb)
                    {
                        subreq = true;
                        this.subscribe(topic, cb);
                    });
                }

                for (var mqserver of connections.keys())
                {
                    regreq(mqserver);
                }

                clients[0].subscribe('foo', function (s, info)
                {
                    if (!options.relay)
                    {
                        expect(pubreq).to.equal(true);
                        expect(subreq).to.equal(true);
                    }

                    expect(info.topic).to.equal('foo');
                    expect(info.single).to.equal(false);

                    read_all(s, function (v)
                    {
                        expect(v.toString()).to.equal('bar');
                        done();
                    });
                }, function (err)
                {
                    if (err) { return done(err); }
                    clients[0].publish('foo').end('bar');
                });
            });
        });

        describe('access control with block', function ()
        {
            setup(1,
            {
                access_control: {
                    publish: {
                        allow: ['foo.#'],
                        disallow: []
                    },
                    subscribe: {
                        allow: ['foo.#'],
                        disallow: []
                    },
                    block: ['foo.bar']
                }
            });

            it('should block message', function (done)
            {
                var blocked = 0;

                function regblock(info)
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

                for (var info of connections.values())
                {
                    regblock(info);
                }
                
                clients[0].subscribe('foo.bar', function (s, info)
                {
                    done(new Error('should not be called'));
                }, function (err)
                {
                    if (err) { return done(err); }
                    clients[0].subscribe('foo', function (s, info)
                    {
                        expect(info.topic).to.equal('foo');
                        expect(info.single).to.equal(false);

                        read_all(s, function (v)
                        {
                            expect(v.toString()).to.equal('bar');
                            clients[0].publish('foo.bar').end('foobar');
                        });
                    }, function (err)
                    {
                        if (err) { return done(err); }
                        clients[0].publish('foo').end('bar');
                    });
                });
            });
        });

        describe('access control with self', function ()
        {
            setup(1,
            {
                access_control: {
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
                }, function (err)
                {
                    if (err) { return done(err); }
                    clients[0].publish('all.${self}.foo').end('bar');
                });
            });
        });

        describe('access control with self and ack', function ()
        {
            setup(1,
            {
                access_control: {
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
                ack: {
                    prefix: 'ack.${self}.'
                }
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
                }, function (err)
                {
                    if (err) { return done(err); }
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
                    }, function (err)
                    {
                        if (err) return done(err);
                        clients[0].publish('all.${self}.foo', { single: true }).end('bar');
                    });
                });
            });
        });

        describe('access control with self and presence', function ()
        {
            setup(2,
            {
                access_control: {
                    publish: {
                        allow: ['direct.${self}.*.#',
                                'all.${self}.#',
                                'join.direct.${self}.*',
                                'join.all.${self}',
                                'foo'],
                        disallow: []
                    },
                    subscribe: {
                        allow: ['direct.*.${self}.#',
                                'all.*.#',
                                'join.direct.*.${self}',
                                'join.all.*',
                                'leave.all.*',
                                'foo'],
                        disallow: []
                    }
                },
                presence: {
                    connect: {
                        prefix: 'join.',
                        data: 'someone joined'
                    },
                    disconnect: {
                        topic: 'leave.all.${self}',
                        data: 'someone left'
                    }
                }
            });
            
            it('should support presence', function (done)
            {
                var pubreq = false;

                function regreq(mqserver)
                {
                    mqserver.on('publish_requested', function (topic, stream, options, cb)
                    {
                        pubreq = true;
                        stream.pipe(this.fsq.publish(topic, options, cb));
                    });
                }

                for (var mqserver of connections.keys())
                {
                    regreq(mqserver);
                }

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
                }, function (err)
                {
                    if (err) { return done(err); }
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
                            expect(pubreq).to.equal(false);
                            done();
                        });
                    }, function (err)
                    {
                        if (err) { return done(err); }
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
                        }, function (err)
                        {
                            if (err) { return done(err); }
                            clients[0].publish('join.all.${self}').end('bar');
                        });
                    });
                });
            });

            it('with presence in place should emit publish_requested and subscribe_requested for non-presence messages', function (done)
            {
                var pubreq = false,
                    subreq = false;

                function regreq(mqserver)
                {
                    mqserver.on('publish_requested', function (topic, stream, options, cb)
                    {
                        pubreq = true;
                        stream.pipe(this.fsq.publish(topic, options, cb));
                    });

                    mqserver.on('subscribe_requested', function (topic, cb)
                    {
                        subreq = true;
                        this.subscribe(topic, cb);
                    });
                }

                for (var mqserver of connections.keys())
                {
                    regreq(mqserver);
                }

                clients[0].subscribe('foo', function (s, info)
                {
                    if (!options.relay)
                    {
                        expect(pubreq).to.equal(true);
                        expect(subreq).to.equal(true);
                    }

                    expect(info.topic).to.equal('foo');
                    expect(info.single).to.equal(false);

                    read_all(s, function (v)
                    {
                        expect(v.toString()).to.equal('bar');
                        done();
                    });
                }, function (err)
                {
                    if (err) { return done(err); }
                    clients[0].publish('foo').end('bar');
                });
            });
        });

        describe('error handling', function (done)
        {
            setup(1,
            {
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
            });

            it('should emit carrier stream error as warning', function (done)
            {
                server.once('warning', function (err)
                {
                    expect(err.message).to.equal('dummy');
                    done();
                });

                for (var mqserver of connections.keys())
                {
                    mqserver.mux.carrier.emit('error', new Error('dummy'));
                }
            });

            it('should emit publish stream error as warning', function (done)
            {
                var warned = false;

                server.once('warning', function (err)
                {
                    expect(err.message).to.equal('dummy2');
                    warned = true;
                });

                function pubreq(topic, stream, options, done)
                {
                    expect(topic).to.equal(info[1].prefixes[0] + 'foo');
                    stream.emit('error', new Error('dummy2'));
                    done();
                }

                function connect(info)
                {
                    info.mqserver.on('publish_requested', pubreq);
                }

                server.once('connect', connect);

                for (var info of connections)
                {
                    info[0].on('publish_requested', pubreq);
                }
        
                clients[0].publish('foo', function (err)
                {
                    expect(warned).to.equal(true);
                    server.removeListener('connect', connect);
                    done(err);
                }).end('bar');
            });

            it('should emit message error as warning', function (done)
            {
                var count = 0;

                server.on('warning', function warning(err)
                {
                    expect(err.message).to.equal('dummy');
                    count += 1;
                    // One for fsq 'warning' event
                    // One for mqlobber 'warning' event
                    if (count === 2)
                    {
                        this.removeListener('warning', warning);
                        done();
                    } else if (count > 2)
                    {
                        done(new Error('called too many times'));
                    }
                });

                for (var mqserver of connections.keys())
                {
                    mqserver.on('message', function (stream, info, multiplex, done)
                    {
                        done(new Error('dummy'));
                    });
                }

                clients[0].subscribe('foo', function ()
                {
                    done(new Error('should not be called'));
                }, function (err)
                {
                    if (err) { return done(err); }
                    clients[0].publish('foo', function (err)
                    {
                        if (err) { return done(err); }
                    }).end('bar');
                });
            });
        });

        describe('pre-connect error handling', function (done)
        {
            beforeEach(function ()
            {
                server.once('pre_connect', function (info)
                {
                    info.destroy();
                });
            });

            setup(1,
            {
                access_control: {
                    publish: {
                        allow: ['foo'],
                        disallow: []
                    },
                    subscribe: {
                        allow: ['foo'],
                        disallow: []
                    }
                },
                skip_ready: true,
                client_function: function (c, onconnect)
                {
                    c.on('error', function (err)
                    {
                        this.last_error = err;
                        onconnect();
                    });
                }
            });

            it('should error if carrier ends before client connects', function (done)
            {
                function check_error(err)
                {
                    expect(err.message).to.equal('ended before ready');
                    done();
                }

                if (clients[0].last_error)
                {
                    return check_error(clients[0].last_error);
                }

                clients[0].on('error', check_error);
            });
        });
    });
};
