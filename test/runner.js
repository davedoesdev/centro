/*jshint mocha: true */
"use strict";

var centro = require('..'),
    CentroServer = centro.CentroServer,
    ursa = require('ursa'),
    jsjws = require('jsjws'),
    expect = require('chai').expect,
    async = require('async'),
    uri = 'mailto:dave@davedoesdev.com',
    uri2 = 'mailto:david@davedoesdev.com';

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
        var server, clients,
            priv_key, priv_key2,
            issuer_id, issuer_id2,
            rev, rev2,
            connections = new Map();

        function on_before(cb)
        {
            function start()
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

                        priv_key2 = ursa.generatePrivateKey(2048, 65537);
                        server.authz.keystore.add_pub_key(uri2, priv_key2.toPublicPem('utf8'),
                        function (err, the_issuer_id, the_rev)
                        {
                            if (err)
                            {
                                return cb(err);
                            }
                            
                            issuer_id2 = the_issuer_id;
                            rev2 = the_rev;

                            cb();
                        });
                    });
                });
            }

            if (config.fsq && !config.fsq.initialized)
            {
                config.fsq.on('start', start);
            }
            else
            {
                start();
            }
        }
        
        before(on_before);

        function on_after(cb)
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

                server.authz.keystore.remove_pub_key(uri2, function (err)
                {
                    if (err)
                    {
                        return cb(err);
                    }

                    server.close(function ()
                    {
                        if (config.fsq)
                        {
                            expect(server.fsq._stopped).to.equal(false);
                            config.fsq.stop_watching(cb);
                        }
                        else
                        {
                            expect(server.fsq._stopped).to.equal(true);
                            cb();
                        }
                    });
                });
            });
        }

        after(on_after);

        function setup(n, opts)
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
                }

                server.on('connect', onconnect);

                var token_exp = new Date();
				if (opts.ttl !== undefined)
                {
                    token_exp.setSeconds(token_exp.getSeconds() + opts.ttl);
                }
                else
                {
                    token_exp.setMinutes(token_exp.getMinutes() + 1);
                }

                var access_control = opts.access_control;
                if (!Array.isArray(access_control))
                {
                    access_control = [access_control, access_control];
                }

                async.times(n, function (i, next)
                {
                    if (opts.server_function)
                    {
                        opts.server_function(server);
                    }

                    var token = new jsjws.JWT().generateJWTByKey(
                    {
                        alg: 'PS256'
                    },
                    {
                        iss: issuer_id,
                        access_control: access_control[0],
                        ack: opts.ack,
                        presence: opts.presence
                    }, token_exp, priv_key);

                    var token2 = new jsjws.JWT().generateJWTByKey(
                    {
                        alg: 'PS256'
                    },
                    {
                        iss: issuer_id2,
                        access_control: access_control[1],
                        ack: opts.ack,
                        presence: opts.presence
                    }, token_exp, priv_key2);

                    connect(
                    {
                        token: opts.no_token ? '' :
                               i % 2 === 0 || options.anon ? token :
                               [token, token2],
                        handshake_data: new Buffer([i])
                    }, server, function (err, c)
                    {
                        if (err)
                        {
                            return next(err);
                        }

                        if (opts.client_function)
                        {
                            opts.client_function(c, onconnect);
                        }

                        if (opts.skip_ready)
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
                    if (c.mux.carrier._readableState.ended ||
                        c.mux.carrier.destroyed)
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

            it('should unsubscribe', function (done)
            {
                function handler()
                {
                    done(new Error('should not be called'));
                }

                clients[0].subscribe('foo', handler, function (err)
                {
                    if (err) { return done(err); }
                    clients[0].unsubscribe('foo', handler, function (err)
                    {
                        if (err) { return done(err); }
                        clients[0].publish('foo', function (err)
                        {
                            setTimeout(done, 1000);
                        }).end('bar');
                    });
                });
            });

            it('should unsubscribe all handlers on a topic', function (done)
            {
                function handler()
                {
                    done(new Error('should not be called'));
                }

                function handler2()
                {
                    done(new Error('should not be called'));
                }

                clients[0].subscribe('foo', handler, function (err)
                {
                    if (err) { return done(err); }
                    clients[0].subscribe('foo', handler2, function (err)
                    {
                        if (err) { return done(err); }
                        clients[0].unsubscribe('foo', undefined, function (err)
                        {
                            if (err) { return done(err); }
                            clients[0].publish('foo', function (err)
                            {
                                setTimeout(done, 1000);
                            }).end('bar');
                        });
                    });
                });
            });

            it('should unsubscribe twice without error', function (done)
            {
                function handler()
                {
                    done(new Error('should not be called'));
                }

                clients[0].subscribe('foo', handler, function (err)
                {
                    if (err) { return done(err); }
                    clients[0].unsubscribe('foo', handler, function (err)
                    {
                        if (err) { return done(err); }
                        clients[0].unsubscribe('foo', handler, function (err)
                        {
                            if (err) { return done(err); }
                            clients[0].publish('foo', function (err)
                            {
                                if (err) { return done(err); }
                                setTimeout(done, 1000);
                            }).end('bar');
                        });
                    });
                });
            });

            it('should unsubscribe all handlers on a topic twice without error', function (done)
            {
                function handler()
                {
                    done(new Error('should not be called'));
                }

                function handler2()
                {
                    done(new Error('should not be called'));
                }

                clients[0].subscribe('foo', handler, function (err)
                {
                    if (err) { return done(err); }
                    clients[0].subscribe('foo', handler2, function (err)
                    {
                        if (err) { return done(err); }
                        clients[0].unsubscribe('foo', undefined, function (err)
                        {
                            if (err) { return done(err); }
                            clients[0].unsubscribe('foo', undefined, function (err)
                            {
                                if (err) { return done(err); }
                                clients[0].publish('foo', function (err)
                                {
                                    setTimeout(done, 1000);
                                }).end('bar');
                            });
                        });
                    });
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

            it('should dedup handlers', function (done)
            {
                var called = false;

                function handler(s, info)
                {
                    expect(called).to.equal(false);
                    called = true;

                    expect(info.topic).to.equal('foo');
                    expect(info.single).to.equal(false);

                    read_all(s, function (v)
                    {
                        expect(v.toString()).to.equal('bar');
                        done();
                    });
                }
 
                clients[0].subscribe('foo', handler, function (err)
                {
                    if (err) { return done(err); }
                    clients[0].subscribe('foo', handler, function (err)
                    {
                        if (err) { return done(err); }
                        clients[0].publish('foo').end('bar');
                    });
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
                            expect(pubreq).to.equal(false);
                            clients[1].unsubscribe('leave.all.*', undefined, done);
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

        describe('error handling', function ()
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

                function regmsg(mqserver)
                {
                    mqserver.on('message', function (stream, info, multiplex, done)
                    {
                        done(new Error('dummy'));
                    });
                }

                for (var mqserver of connections.keys())
                {
                    regmsg(mqserver);
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

            it('should emit fsq error as error', function (done)
            {
                server.once('error', function (err)
                {
                    expect(err.message).to.equal('dummy');
                    done();
                });

                server.fsq.emit('error', new Error('dummy'));
            });
        });

        describe('end before connect', function ()
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
                    expect(err.message).to.equal('ended before handshaken');
                    done();
                }

                if (clients[0].last_error)
                {
                    return check_error(clients[0].last_error);
                }

                clients[0].on('error', check_error);
            });
        });

        describe('non-JSON handshake data', function ()
        {
            beforeEach(function ()
            {
                server.once('pre_connect', function (info)
                {
                    info.mqserver.on('handshake', function (hsdata, delay)
                    {
                        delay()(new Buffer([0, 1, 2]));
                    });
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
                    expect(err.message).to.equal('Unexpected token \u0000');
                    done();
                }

                if (clients[0].last_error)
                {
                    return check_error(clients[0].last_error);
                }

                clients[0].on('error', check_error);
            });
        });

        describe('invalid handshake data', function ()
        {
            beforeEach(function ()
            {
                server.once('pre_connect', function (info)
                {
                    info.mqserver.on('handshake', function (hsdata, delay)
                    {
                        delay()(new Buffer(JSON.stringify(
                        {
                            hello: 90
                        })));
                    });
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
                    expect(err.message).to.equal("data should have required property 'self'");
                    done();
                }

                if (clients[0].last_error)
                {
                    return check_error(clients[0].last_error);
                }

                clients[0].on('error', check_error);
            });
        });

        describe('multiple tokens', function ()
        {
            setup(2,
            {
                access_control: [{
                    publish: {
                        allow: ['blue', 'test'],
                        disallow: []
                    },
                    subscribe: {
                        allow: ['foo', 'blue', 'test'],
                        disallow: []
                    }
                }, {
                    publish: {
                        allow: ['red', 'test'],
                        disallow: []
                    },
                    subscribe: {
                        allow: ['bar', 'red', 'test'],
                        disallow: []
                    }
                }]
            });

            it('should be able to select token to use for operation', function (done)
            {
                var sub_tests = [
                    [0, 0, 'foo', true],
                    [0, 0, 'bar', false],
                    [0, 1, 'foo', false],
                    [0, 1, 'bar', false]
                ];

                if (!options.anon)
                {
                    sub_tests.push(
                        [1, 0, 'foo', true],
                        [1, 0, 'bar', false],
                        [1, 1, 'foo', false],
                        [1, 1, 'bar', true]);
                }

                var pub_tests = [
                    [0, 0, 'blue', true],
                    [0, 0, 'red', false],
                    [0, 1, 'blue', false],
                    [0, 1, 'red', false]
                ];

                if (!options.anon)
                {
                    pub_tests.push(
                        [1, 0, 'blue', true],
                        [1, 0, 'red', false],
                        [1, 1, 'blue', false],
                        [1, 1, 'red', true]);
                }

                async.eachSeries(sub_tests, function (t, next)
                {
                    function regblock(info)
                    {
                        var warning;

                        server.once('warning', function (err)
                        {
                            warning = err.message;
                        });

                        info.access_control.once('subscribe_blocked',
                        function (topic, mqserver)
                        {
                            expect(mqserver).to.equal(info.mqserver);
                            expect(topic).to.equal(info.prefixes[t[1]] + t[2]);
                            expect(warning).to.equal('blocked subscribe to topic: ' + topic);
                            next();
                        });
                    }

                    if (!t[3])
                    {
                        for (var info of connections.values())
                        {
                            if (info.hsdata[0] === t[0])
                            {
                                regblock(info);
                            }
                        }
                    }
     
                    clients[t[0]].subscribe(t[1], t[2], function (s, info, cb)
                    {
                        done(new Error('should not be called'));
                    }, function (err)
                    {
                        if (t[3])
                        {
                            expect(err).to.equal(undefined);
                            next();
                        }
                        else
                        {
                            expect(err.message).to.equal('server error');
                        }
                    });
                }, function (err)
                {
                    if (err) { return done(err); }

                    async.eachSeries(pub_tests, function (t, next)
                    {
                        function regblock(info)
                        {
                            var warning;

                            server.once('warning', function (err)
                            {
                                warning = err.message;
                            });

                            info.access_control.once('publish_blocked',
                            function (topic, mqserver)
                            {
                                expect(mqserver).to.equal(info.mqserver);
                                expect(topic).to.equal(info.prefixes[t[1]] + t[2]);
                                expect(warning).to.equal('blocked publish to topic: ' + topic);
                                next();
                            });
                        }

                        function publish(err)
                        {
                            if (err) { return done(err); }

                            var s = clients[t[0]].publish(t[1], t[2], function (err)
                            {
                                if (t[3])
                                {
                                    expect(err).to.equal(undefined);
                                }
                                else
                                {
                                    expect(err.message).to.equal('server error');
                                }
                            });
                            
                            if (t[3])
                            {
                                s.end('test');
                            }
                            else
                            {
                                s.end();
                            }
                        }

                        if (t[3])
                        {
                            clients[t[0]].subscribe(t[1], t[2], function sub(s, info, cb)
                            {
                                expect(info.topic).to.equal(t[2]);

                                var ths = this;

                                read_all(s, function (v)
                                {
                                    expect(v.toString()).to.equal('test');
                                    ths.unsubscribe(t[1], t[2], sub, next);
                                });
                            }, publish);
                        }
                        else
                        {
                            if (options.relay)
                            {
                                server.once('connect', function (info)
                                {
                                    regblock(info);
                                });
                            }
                            else
                            {
                                for (var info of connections.values())
                                {
                                    if (info.hsdata[0] === t[0])
                                    {
                                        regblock(info);
                                    }
                                }
                            }

                            publish();
                        }
                    }, done);
                });
            });

            it('should unsubscribe all handlers', function (done)
            {
                var called = false;

                function handler(s, info)
                {
                    if (options.anon)
                    {
                        return done(new Error('should not be called'));
                    }

                    expect(called).to.equal(false);
                    called = true;

                    expect(info.single).to.equal(false);

                    read_all(s, function (v)
                    {
                        expect(v.toString()).to.equal('bar');
                        setTimeout(done, 1000);
                    });
                }

                var n = options.anon ? 0 : 1;

                clients[1].subscribe('test', handler, function (err)
                {
                    if (err) { return done(err); }
                    clients[1].subscribe(n, 'test', handler, function (err)
                    {
                        if (err) { return done(err); }
                        clients[1].unsubscribe(function (err)
                        {
                            if (err) { return done(err); }
                            clients[1].publish('test', function (err)
                            {
                                if (err) { return done(err); }
                                clients[1].publish(n, 'test', function (err)
                                {
                                    if (err) { return done(err); }
                                    if (options.anon)
                                    {
                                        setTimeout(done, 1000);
                                    }
                                }).end('bar');
                            }).end('bar');
                        });
                    });
                });
            });

            it('should unsubscribe twice without error', function (done)
            {
                function handler()
                {
                    done(new Error('should not be called'));
                }

                clients[0].subscribe('test', handler, function (err)
                {
                    if (err) { return done(err); }
                    clients[1].subscribe('test', handler, function (err)
                    {
                        if (err) { return done(err); }
                        clients[0].unsubscribe('test', handler, function (err)
                        {
                            if (err) { return done(err); }
                            clients[0].unsubscribe('test', handler, function (err)
                            {
                                if (err) { return done(err); }
                                clients[1].unsubscribe('foo', handler, function (err)
                                {
                                    if (err) { return done(err); }
                                    clients[1].unsubscribe('test', handler, function (err)
                                    {
                                        if (err) { return done(err); }
                                        clients[0].publish('test', function (err)
                                        {
                                            if (err) { return done(err); }
                                            setTimeout(done, 1000);
                                        }).end('bar');
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });

        describe('token expiry', function ()
        {
            this.timeout(5000);

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
                ttl: 2
            });

            it('should close connection when token expires', function (done)
            {
                var empty = false,
                    ended = false;

                server.once('empty', function ()
                {
                    empty = true;
                    if (ended)
                    {
                        done();
                    }
                });

                clients[0].mux.on('end', function ()
                {
                    ended = true;
                    if (empty)
                    {
                        done();
                    }
                });
            });
        });

        function client_function(c, onconnect)
        {
            c.errors = [];

            c.on('error', function (err)
            {
                console.log(err);
                this.errors.push(err);
                onconnect();
            });

            if (name !== 'primus')
            {
                return;
            }

            c.mux.carrier.msg_stream.on('outgoing::open', function ()
            {
                this.socket.on('unexpected-response', function (req, res)
                {
                    var ths = this,
                        err = new Error('unexpected response');

                    err.statusCode = res.statusCode;
                    err.authenticate = res.headers['www-authenticate'];
                    err.data = '';

                    res.on('end', function ()
                    {
                        c.emit('error', err);
                    });

                    res.on('readable', function ()
                    {
                        var data = this.read();
                        if (data !== null)
                        {
                            err.data += data;
                        }
                    });
                });
            });
        }

        function server_function(s)
        {
            s.last_warning = null;
            s.once('warning', function (err)
            {
                this.last_warning = err;
            });
        }

        function expect_error(msg)
        {
            return function (done)
            {
                function check_errors()
                {
                    expect(server.last_warning.message).to.equal(msg);
                    expect(server.last_warning.statusCode).to.equal(401);
                    expect(server.last_warning.authenticate).to.equal('Basic realm="centro"');

                    var errors = clients[0].errors;

                    if (errors.length < 1)
                    {
                        return false;
                    }

                    if (name === 'primus')
                    {
                        if (errors.length < 2)
                        {
                            return false;
                        }

                        if (errors.length > 2)
                        {
                            done(new Error('too many errors'));
                            return false;
                        }

                        expect(errors[0].message).to.equal('unexpected response');
                        expect(errors[0].statusCode).to.equal(401);
                        expect(errors[0].authenticate).to.equal('Basic realm="centro"');
                        expect(errors[0].data).to.equal('{"error":"' + msg + '"}');

                        expect(errors[1].message).to.equal('ended before handshaken');
                    }
                    else
                    {
                        if (errors.length > 1)
                        {
                            done(new Error('too many errors'));
                            return false;
                        }

                        expect(errors[0].message).to.equal('ended before handshaken');
                    }

                    done();
                    return true;
                }

                if (!check_errors())
                {
                    clients[0].on('error', check_errors);
                }
            };
        }

        describe('expired token', function ()
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
                },
                ttl: 0,
                skip_ready: true,
                client_function: client_function,
                server_function: server_function
            });

            it('should fail to authorize', expect_error('expired'));
        });

        describe('no tokens', function ()
        {
            setup(1,
            {
                no_token: true,
                skip_ready: true,
                client_function: client_function,
                server_function: server_function
            });

            it('should fail to authorize', expect_error('no tokens'));
        });

        describe('close', function ()
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

            function close(f)
            {
                if (options.relay)
                {
                    server.once('connect', f);
                }

                if (name === 'tcp')
                {
                    clients[0].on('error', function (err)
                    {
                        expect(err.message).to.equal('write EPIPE');
                    });
                }

                clients[0].publish('foo').write('bar');

                if (!options.relay)
                {
                    f();
                }
            }

            it('should close the server', function (done)
            {
                close(function ()
                {
                    server.close(function (err)
                    {
                        if (err) { return done(err); }
                        on_before(done);
                    });
                });
            });

            it('should emit a close event', function (done)
            {
                close(function ()
                {
                    server.on('close', function ()
                    {
                        on_before(done);
                    });

                    server.close();
                });
            });

            it('should be able to close the server twice in series', function (done)
            {
                close(function ()
                {
                    server.close(function (err)
                    {
                        if (err) { return done(err); }
                        server.close(function (err)
                        {
                            if (err) { return done(err); }
                            on_before(done);
                        });
                    });
                });
            });

            it('should be able to close the server twice in parallel', function (done)
            {
                var called = 0;

                function check(err)
                {
                    if (err) { return done(err); }
                    called += 1;
                    if (called === 2)
                    {
                        on_before(done);
                    }
                    else if (called > 2)
                    {
                        done(new Error('called too many times'));
                    }
                }

                close(function ()
                {
                    server.close(check);
                    server.close(check);
                });
            });

            it('should pass back close transport errors', function (done)
            {
                var orig_close = server.transport_ops[0].close;

                server.transport_ops[0].close = function (cb)
                {
                    orig_close.call(this, function (err)
                    {
                        if (err) { return done(err); }
                        cb(new Error('dummy'));
                    });
                };

                server.on('close', function ()
                {
                    on_before(done);
                });

                close(function ()
                {
                    server.close(function (err, cont)
                    {
                        expect(err.message).to.equal('dummy');
                        cont();
                    });
                });
            });

            if (!options.anon)
            {
                it.only('should pass back close keystore errors', function (done)
                {
                    var orig_close = server.authz.keystore.close;

                    server.authz.keystore.close = function (cb)
                    {
                        orig_close.call(this, function (err)
                        {
                            if (err) { return done(err); }
                            cb(new Error('dummy'));
                        });
                    };

                    server.on('close', function ()
                    {
                        on_before(done);
                    });

                    close(function ()
                    {
                        server.close(function (err, cont)
                        {
                            expect(err.message).to.equal('dummy');
                            cont();
                        });
                    });
                });
            }
        });
    });
};
