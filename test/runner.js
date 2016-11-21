/*jshint mocha: true */
"use strict";

var centro = require('..'),
    CentroServer = centro.CentroServer,
    util = require('util'),
    crypto = require('crypto'),
    ursa = require('ursa'),
    jsjws = require('jsjws'),
    expect = require('chai').expect,
    async = require('async'),
    Throttle = require('stream-throttle').Throttle,
    Transform = require('stream').Transform,
    Writable = require('stream').Writable,
    FastestWritable = require('fastest-writable').FastestWritable,
    read_all = require('./read_all'),
    uri = 'mailto:dave@davedoesdev.com',
    uri2 = 'mailto:david@davedoesdev.com';

function NullStream()
{
    Writable.call(this);
}

util.inherits(NullStream, Writable);

NullStream.prototype._write = function ()
{
};

var presence_topics = new Set();
var pending_presence_topics = new Set();

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
            config.transport.server = CentroServer.load_transport(
                                          config.transport.server);
        }
        else
        {
            config.transport = CentroServer.load_transport(config.transport);
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
                config.transport[i].server = CentroServer.load_transport(
                                                 config.transport[i].server);
            }
            else
            {
                config.transport[i] = CentroServer.load_transport(
                                          config.transport[i]);
            }
        }
    }

    config.authorize = require('authorize-jwt');
    config.db_type = 'pouchdb';
    config.db_for_update = true;
    config.max_tokens = 2;
    config.max_token_size = 16 * 1024;
    config.maxSize = config.max_token_size;
    config.send_expires = true;
    config.multi_ttl = 10 * 60 * 1000;

    function is_transport(n)
    {
        return name.lastIndexOf(n) === 0;
    }

    function run(config)
    {
        /* jshint validthis: true */
        this.timeout(5000);

        var server, clients,
            priv_key, priv_key2,
            issuer_id, issuer_id2,
            rev, rev2,
            connections = new Map();

        function on_before(cb)
        {
            function start2()
            {
                server = new centro.CentroServer(config);

                server.on('connect', function (info)
                {
                    pending_presence_topics.add('join.' + info.connid);
                    pending_presence_topics.add('leave.' + info.connid);
                    pending_presence_topics.add('ready.all.' + info.connid);
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

                server.on('warning', function (err)
                {
                    console.warn(err);
                    this.last_warning = err;
                });
            }

            function start()
            {
                if (config.fsq && !config.fsq.initialized)
                {
                    config.fsq.on('start', start2);
                }
                else
                {
                    start2();
                }
            }

            if (options.on_before)
            {
                return options.on_before(config, start);
            }

            start();
        }
        
        before(on_before);

        function on_after(cb2)
        {
            function cb(err)
            {
                if (err)
                {
                    return cb2(err);
                }

                if (options.on_after)
                {
                    return options.on_after(config, cb2);
                }

                cb2();
            }

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
                server.last_warning = null;

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

                var orig_stream_auth = centro.stream_auth,
                    orig_separate_auth = centro.separate_auth;
                if (opts.end_immediately)
                {
                    centro.stream_auth = function (stream, config)
                    {
                        stream.end();
                        return null;
                    };
                    centro.separate_auth = function (config, cb)
                    {
                        orig_separate_auth.call(this, config, function (err, userpass, make_client)
                        {
                            cb(err, '', make_client);
                        });
                    };
                }

                if (opts.before_connect_function)
                {
                    opts.before_connect_function();
                }

                var token = new jsjws.JWT().generateJWTByKey(
                {
                    alg: 'PS256'
                },
                {
                    iss: issuer_id,
                    access_control: access_control[0],
                    ack: opts.ack,
                    presence: opts.presence,
                }, token_exp, priv_key);

                var token2 = new jsjws.JWT().generateJWTByKey(
                {
                    alg: 'PS256'
                },
                {
                    iss: opts.same_issuer ? issuer_id : issuer_id2,
                    access_control: access_control[1],
                    ack: opts.ack,
                    presence: opts.presence,
                    subscribe: opts.subscribe
                }, token_exp, opts.same_issuer ? priv_key : priv_key2);

                (opts.series ? async.timesSeries : async.times)(n, function (i, next)
                {
                    connect(
                    {
                        token: opts.no_token ? '' :
                               opts.too_many_tokens ? [token, token2, token] :
                               opts.long_token ? new Array(config.max_token_size + 2).join('A') :
                               opts.duplicate_tokens ? [token, token] :
                               i % 2 === 0 || (options.anon && !opts.separate_tokens) ? token :
                               opts.separate_tokens ? token2 : [token, token2],
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

                        if (opts.skip_ready || opts.end_immediately)
                        {
                            return next(null, c);
                        }

                        c.on('ready', function (subscriptions)
                        {
                            c.subscriptions = subscriptions;

                            if (opts.client_ready)
                            {
                                return opts.client_ready.call(this, i, next);
                            }

                            next(null, this);
                        });
                    });
                }, function (err, cs)
                {
                    if (opts.end_immediately)
                    {
                        centro.stream_auth = orig_stream_auth;
                        centro.separate_auth = orig_separate_auth;
                    }

                    if (err)
                    {
                        return cb(err);
                    }

                    clients = cs;

                    if (opts.end_immediately && !is_transport('primus'))
                    {
                        server.removeListener('connect', onconnect);
                        return setTimeout(cb, 1000);
                    }

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
                    expect(server._pending_authz_destroys.size).to.equal(0);
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
                    if (!c ||
                        c.mux.carrier._readableState.ended ||
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

        function get_info()
        {
            return {
                config: config,
                server: server,
                priv_key: priv_key,
                issuer_id: issuer_id,
                clients: clients,
                connections: connections,
                setup: setup
            };
        }

        if (config.only)
        {
            return config.only(get_info, on_before);
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
                expect(clients[0].subscriptions).to.equal(undefined);

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

        describe('large message', function ()
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
                ttl: 10 * 60
            });

            it('large message', function (done)
            {
                this.timeout(10 * 60 * 1000);

                var buf = crypto.randomBytes(1 * 1024 * 1024);

                clients[0].subscribe('foo', function (s, info)
                {
                    expect(info.topic).to.equal('foo');
                    expect(info.single).to.equal(false);

                    read_all(s, function (v)
                    {
                        expect(v.equals(buf));
                        done();
                    });
                }, function (err)
                {
                    if (err) { return done(err); }
                    clients[0].publish('foo', { ttl: 10 * 60 }).end(buf);
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

            if (!options.anon)
            {
                it('should not send ack message if prefix not recognised', function (done)
                {
                    server.once('warning', function (err)
                    {
                        expect(err.message).to.equal('unknown prefix on ack topic: foo');
                        done();
                    });

                    clients[0].subscribe(options.relay ? 'ack.*.all.*.foo' :
                                                         'ack.*.all.${self}.foo',
                    function ()
                    {
                        done(new Error('should not be called'));
                    }, function (err)
                    {
                        if (err) return done(err);

                        var mqserver = connections.keys().next().value;

                        mqserver.subscribe('foo', function (err)
                        {
                            if (err) { return done(err); }

                            clients[0]._matcher.add('foo', function (s, info, done)
                            {
                                done();
                            });

                            mqserver.fsq.publish('foo',
                            {
                                single: true,
                                ttl: 2000
                            }).end();
                        });
                    });
                });
            }
        });

        function pdone(done)
        {
            return function (err)
            {
                for (var t of pending_presence_topics)
                {
                    presence_topics.add(t);
                }

                done(err);
            };
        }

        function client_ready(single, ttl, data)
        {
            return function (i, next)
            {
                if (i === 0)
                {
                    var ths = this;
                    this.joins = new Set();
                    return this.subscribe('join.*', function (s, info)
                    {
                        if (presence_topics.has(info.topic)) { return; }
                        expect(info.single).to.equal(single);
                        if (ttl)
                        {
                            expect(info.expires).to.be.below(new Date().getTime() / 1000 + ttl);
                        }
                        read_all(s, function (v)
                        {
                            expect(v.toString()).to.equal(typeof(data) === 'string' ? data : '"someone joined"');
                            ths.joins.add(info.topic);
                        });
                    }, function (err)
                    {
                        next(err, ths);
                    });
                }

                next(null, this);
            };
        }

        function check_join(cont)
        {
            if (clients[0].joins.has('join.' + clients[1].self))
            {
                return cont();
            }

            setTimeout(function ()
            {
                check_join(cont);
            }, 1000);
        }

        describe('access control with self and presence', function ()
        {
            setup(2,
            {
                access_control: {
                    publish: {
                        allow: ['direct.${self}.*.#',
                                'all.${self}.#',
                                'ready.direct.${self}.*',
                                'ready.all.${self}',
                                'foo'],
                        disallow: []
                    },
                    subscribe: {
                        allow: ['direct.*.${self}.#',
                                'all.*.#',
                                'join.*',
                                'leave.*',
                                'ready.direct.*.${self}',
                                'ready.all.*',
                                'foo'],
                        disallow: []
                    }
                },
                presence: {
                    connect: {
                        topic: 'join.${self}',
                        data: 'someone joined'
                    },
                    disconnect: {
                        topic: 'leave.${self}',
                        data: 'someone left'
                    }
                },
                series: true,
                client_ready: client_ready(false)
            });

            it('should support presence', function (done)
            {
                check_join(function ()
                {
                    clients[0].subscribe('ready.all.*', function (s, info)
                    {
                        if (presence_topics.has(info.topic)) { return; }

                        if (!options.relay)
                        {
                            expect(info.topic).to.equal('ready.all.${self}');
                        }

                        expect(info.single).to.equal(false);

                        read_all(s, function (v)
                        {
                            expect(v.toString()).to.equal('bar');
                        });
                    }, function (err)
                    {
                        if (err) { return done(err); }
                        clients[1].subscribe('leave.*', function (s, info)
                        {
                            if (presence_topics.has(info.topic)) { return; }

                            if (!options.relay)
                            {
                                expect(info.topic).to.equal('leave.' + clients[0].self);
                            }

                            expect(info.single).to.equal(false);

                            read_all(s, function (v)
                            {
                                expect(v.toString()).to.equal('"someone left"');
                                clients[1].unsubscribe('leave.*', undefined, pdone(done));
                            });
                        }, function (err)
                        {
                            if (err) { return done(err); }
                            clients[1].subscribe('ready.all.*', function (s, info)
                            {
                                if (presence_topics.has(info.topic)) { return; }

                                if (!options.relay)
                                {
                                    expect(info.topic).to.equal('ready.all.' + clients[0].self);
                                }

                                expect(info.single).to.equal(false);

                                read_all(s, function (v)
                                {
                                    expect(v.toString()).to.equal('bar');
                                    clients[0].mux.carrier.end();
                                });
                            }, function (err)
                            {
                                if (err) { return done(err); }
                                clients[0].publish('ready.all.${self}').end('bar');
                            });
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
                        pdone(done)();
                    });
                }, function (err)
                {
                    if (err) { return done(err); }
                    clients[0].publish('foo').end('bar');
                });
            });
        });

        describe('presence with ttl', function ()
        {
            setup(2,
            {
                access_control: {
                    publish: {
                        allow: ['ready.all.${self}'],
                        disallow: []
                    },
                    subscribe: {
                        allow: ['join.*',
                                'leave.*',
                                'ready.all.*'],
                        disallow: []
                    }
                },
                presence: {
                    connect: {
                        topic: 'join.${self}',
                        data: 'someone joined',
                        ttl: 2
                    },
                    disconnect: {
                        topic: 'leave.${self}',
                        data: 'someone left',
                        ttl: 2
                    }
                },
                series: true,
                client_ready: client_ready(false, 2)
            });

            it('should send presence messages with ttl', function (done)
            {
                check_join(function ()
                {
                    clients[0].subscribe('ready.all.*', function (s, info)
                    {
                        if (presence_topics.has(info.topic)) { return; }

                        if (!options.relay)
                        {
                            expect(info.topic).to.equal('ready.all.${self}');
                        }

                        expect(info.single).to.equal(false);

                        read_all(s, function (v)
                        {
                            expect(v.toString()).to.equal('bar');
                        });
                    }, function (err)
                    {
                        if (err) { return done(err); }
                        clients[1].subscribe('leave.*', function (s, info)
                        {
                            if (presence_topics.has(info.topic)) { return; }

                            if (!options.relay)
                            {
                                expect(info.topic).to.equal('leave.' + clients[0].self);
                            }

                            expect(info.single).to.equal(false);

                            read_all(s, function (v)
                            {
                                expect(v.toString()).to.equal('"someone left"');
                                expect(info.expires).to.be.below(new Date().getTime() / 1000 + 2);
                                clients[1].unsubscribe('leave.*', undefined, pdone(done));
                            });
                        }, function (err)
                        {
                            if (err) { return done(err); }
                            clients[1].subscribe('ready.all.*', function (s, info)
                            {
                                if (presence_topics.has(info.topic)) { return; }

                                if (!options.relay)
                                {
                                    expect(info.topic).to.equal('ready.all.' + clients[0].self);
                                }

                                expect(info.single).to.equal(false);

                                read_all(s, function (v)
                                {
                                    expect(v.toString()).to.equal('bar');
                                    clients[0].mux.carrier.end();
                                });
                            }, function (err)
                            {
                                if (err) { return done(err); }
                                clients[0].publish('ready.all.${self}').end('bar');
                            });
                        });
                    });
                });
            });
        });

        describe('presence with single', function ()
        {
            setup(2,
            {
                access_control: {
                    publish: {
                        allow: ['ready.all.${self}'],
                        disallow: []
                    },
                    subscribe: {
                        allow: ['join.*',
                                'leave.*',
                                'ready.all.*'],
                        disallow: []
                    }
                },
                presence: {
                    connect: {
                        topic: 'join.${self}',
                        data: 'someone joined',
                        single: true,
                        ttl: 5
                    },
                    disconnect: {
                        topic: 'leave.${self}',
                        data: 'someone left',
                        single: true,
                        ttl: 5
                    }
                },
                series: true,
                client_ready: client_ready(true, 5)
            });

            it('should send presence message with single', function (done)
            {
                check_join(function ()
                {
                    clients[0].subscribe('ready.all.*', function (s, info)
                    {
                        if (presence_topics.has(info.topic)) { return; }

                        if (!options.relay)
                        {
                            expect(info.topic).to.equal('ready.all.${self}');
                        }

                        expect(info.single).to.equal(false);

                        read_all(s, function (v)
                        {
                            expect(v.toString()).to.equal('bar');
                        });
                    }, function (err)
                    {
                        if (err) { return done(err); }
                        clients[1].subscribe('leave.*', function (s, info, ack)
                        {
                            if (presence_topics.has(info.topic)) { return; }

                            if (!options.relay)
                            {
                                expect(info.topic).to.equal('leave.' + clients[0].self);
                            }

                            expect(info.single).to.equal(true);

                            ack();

                            read_all(s, function (v)
                            {
                                expect(v.toString()).to.equal('"someone left"');
                                clients[1].unsubscribe('leave.*', undefined, pdone(done));
                            });
                        }, function (err)
                        {
                            if (err) { return done(err); }
                            clients[1].subscribe('ready.all.*', function (s, info)
                            {
                                if (presence_topics.has(info.topic)) { return; }

                                if (!options.relay)
                                {
                                    expect(info.topic).to.equal('ready.all.' + clients[0].self);
                                }

                                expect(info.single).to.equal(false);

                                read_all(s, function (v)
                                {
                                    expect(v.toString()).to.equal('bar');
                                    clients[0].mux.carrier.end();
                                });
                            }, function (err)
                            {
                                if (err) { return done(err); }
                                clients[0].publish('ready.all.${self}').end('bar');
                            });
                        });
                    });
                });
            });
        });

        describe('presence with no data', function ()
        {
            setup(2,
            {
                access_control: {
                    publish: {
                        allow: ['ready.all.${self}'],
                        disallow: []
                    },
                    subscribe: {
                        allow: ['join.*',
                                'leave.*',
                                'ready.all.*'],
                        disallow: []
                    }
                },
                presence: {
                    connect: {
                        topic: 'join.${self}'
                    },
                    disconnect: {
                        topic: 'leave.${self}'
                    }
                },
                series: true,
                client_ready: client_ready(false, 0, '')
            });

            it('should send leave message with no data', function (done)
            {
                check_join(function ()
                {
                    clients[0].subscribe('ready.all.*', function (s, info)
                    {
                        if (presence_topics.has(info.topic)) { return; }

                        if (!options.relay)
                        {
                            expect(info.topic).to.equal('ready.all.${self}');
                        }

                        expect(info.single).to.equal(false);

                        read_all(s, function (v)
                        {
                            expect(v.toString()).to.equal('');
                        });
                    }, function (err)
                    {
                        if (err) { return done(err); }
                        clients[1].subscribe('leave.*', function (s, info)
                        {
                            if (presence_topics.has(info.topic)) { return; }

                            if (!options.relay)
                            {
                                expect(info.topic).to.equal('leave.' + clients[0].self);
                            }

                            expect(info.single).to.equal(false);

                            read_all(s, function (v)
                            {
                                expect(v.toString()).to.equal('');
                                clients[1].unsubscribe('leave.*', undefined, pdone(done));
                            });
                        }, function (err)
                        {
                            if (err) { return done(err); }
                            clients[1].subscribe('ready.all.*', function (s, info)
                            {
                                if (presence_topics.has(info.topic)) { return; }

                                if (!options.relay)
                                {
                                    expect(info.topic).to.equal('ready.all.' + clients[0].self);
                                }

                                expect(info.single).to.equal(false);

                                read_all(s, function (v)
                                {
                                    expect(v.toString()).to.equal('');
                                    clients[0].mux.carrier.end();
                                });
                            }, function (err)
                            {
                                if (err) { return done(err); }
                                clients[0].publish('ready.all.${self}').end('');
                            });
                        });
                    });
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

                clients[0].on('error', function (err)
                {
                    expect(err.message).to.equal('dummy');
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
                    expect(err.message.lastIndexOf('Unexpected token \u0000', 0)).to.equal(0);
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
                            expect(err).to.equal(null);
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
                                    expect(err).to.equal(null);
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

            if (!is_transport('primus'))
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

        function expect_error(msg, ignore_server, code, cb)
        {
            if ((code !== 0) && !code)
            {
                code = 401;
            }

            return function (done)
            {
                function check_errors()
                {
                    if (!ignore_server)
                    {
                        expect(server.last_warning.message).to.equal(msg);
                        expect(server.last_warning.statusCode).to.equal(
                            code === 401 ? code : undefined);
                        expect(server.last_warning.authenticate).to.equal(
                            code === 401 ? 'Basic realm="centro"' : undefined);
                    }

                    if (clients[0])
                    {
                        var errors = clients[0].errors;

                        if (errors.length < 1)
                        {
                            return false;
                        }

                        if (is_transport('primus') && (code !== 0))
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
                            expect(errors[0].statusCode).to.equal(code);
                            expect(errors[0].authenticate).to.equal(
                                code == 401 ? 'Basic realm="centro"' : undefined);
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
                    }

                    if (cb)
                    {
                        cb(done);
                    }
                    else
                    {
                        done();
                    }

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
                client_function: client_function
            });

            it('should fail to authorize', expect_error('expired'));
        });

        describe('no tokens', function ()
        {
            setup(1,
            {
                no_token: true,
                skip_ready: true,
                client_function: client_function
            });

            it('should fail to authorize', expect_error('no tokens'));
        });

        describe('immediate eos', function ()
        {
            setup(1,
            {
                end_immediately: true,
                client_function: is_transport('primus') ? client_function : undefined
            });

            it('should fail to read tokens',
               expect_error(is_transport('primus') ? 'tokens missing' :
                                                     'ended before frame'));
        });

        describe('max tokens', function ()
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
                too_many_tokens: true,
                skip_ready: true,
                client_function: client_function
            });

            it('should fail to authorize', expect_error('too many tokens'));
        });

        describe('long token', function ()
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
                long_token: true,
                skip_ready: true,
                client_function: client_function
            });

            it('should fail to authorize', expect_error(is_transport('primus') ? 'token too long' : 'Message is larger than the allowed maximum of ' + config.max_token_size));
        });

        describe('duplicate tokens', function ()
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
                duplicate_tokens: true,
                skip_ready: true,
                client_function: client_function
            });

            it('should fail to authorize', expect_error(
                options.anon ? 'too many tokens' : 'duplicate URI: ' + uri));
        });

        describe('invalid payload', function ()
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
                    }
                },
                skip_ready: true,
                client_function: client_function
            });

            it('should fail to authorize', expect_error("data.access_control.subscribe should have required property 'disallow'"));
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

                if (is_transport('tcp'))
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

            it('should be able to call destroy twice', function (done)
            {
                var connids = server._connids;

                function dstroy(f)
                {
                    return function ()
                    {
                        f();
                        f();
                    };
                }

                expect(connids.size).to.equal(1);
                server._connids = new Map();
                for (var entry of connids)
                {
                    server._connids.set(entry[0], dstroy(entry[1]));
                }

                close(function ()
                {
                    server.close(function (err)
                    {
                        if (err) { return done(err); }
                        on_before(done);
                    });
                });
            });

            it('should handle errors from destroy function', function (done)
            {
                var connids = server._connids;

                function dstroy(f)
                {
                    var destroy = f.destroy;
                    f.destroy = function ()
                    {
                        destroy();
                        throw new Error('dummy');
                    };
                    return f;
                }

                expect(connids.size).to.equal(1);
                server._connids = new Map();
                for (var entry of connids)
                {
                    server._connids.set(entry[0], dstroy(entry[1]));
                }

                close(function ()
                {
                    server.close(function (err)
                    {
                        if (err) { return done(err); }
                        on_before(done);
                    });
                });
            });

            if (!options.anon)
            {
                it('should pass back close keystore errors', function (done)
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

        describe('close while authorising', function ()
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
                before_connect_function: function ()
                {
                    var orig_authorize = server.transport_ops[0].authz.authorize;

                    server.transport_ops[0].authz.authorize = function ()
                    {
                        var self = this,
                            args = Array.prototype.slice.call(arguments);

                        server.close(function (err)
                        {
                            if (err) { throw err; }
                            orig_authorize.apply(self, args);
                        });
                    };
                },
                skip_ready: true,
                client_function: client_function
            });

            it("should close connections while they're being authorised",
                expect_error('closed', true, 503, function (done)
                {
                    on_before(done);
                }));
        });

        describe('close while authorising (with exception)', function ()
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
                before_connect_function: function ()
                {
                    var orig_authorize = server.transport_ops[0].authz.authorize;

                    server.transport_ops[0].authz.authorize = function ()
                    {
                        var self = this,
                            args = Array.prototype.slice.call(arguments);

                        function ex(d)
                        {
                            return function ()
                            {
                                d();
                                throw new Error('dummy');
                            };
                        }

                        var ds = server._pending_authz_destroys;
                        server._pending_authz_destroys = new Set();
                        for (var d of ds)
                        {
                            server._pending_authz_destroys.add(ex(d));
                        }

                        server.close(function (err)
                        {
                            if (err) { throw err; }
                            orig_authorize.apply(self, args);
                        });
                    };
                },
                skip_ready: true,
                client_function: client_function
            });

            it("should close connections while they're being authorised",
                expect_error('closed', true, 503, function (done)
                {
                    on_before(done);
                }));
        });

        describe('ended before onclose', function ()
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
                before_connect_function: function ()
                {
                    var orig_set = server._connids.set;
                    server._connids.set = function (connid, dstroy)
                    {
                        server._connids.set = orig_set;
                        dstroy();
                        orig_set.call(this, connid, dstroy);
                    };
                },
                client_function: client_function,
                skip_ready: true
            });

            it('should callback if already ended',
               expect_error('foo', true, 0));
        });

        describe('ended before onclose (2)', function ()
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
                before_connect_function: function ()
                {
                    var orig_set = server._connids.set;
                    server._connids.set = function (connid, dstroy)
                    {
                        server._connids.set = orig_set;
                        dstroy.stream.push(null);
                        dstroy();
                        orig_set.call(this, connid, dstroy);

                        var orig_eachSeries = async.eachSeries;
                        async.eachSeries = function (hs, cb)
                        {
                            async.eachSeries = orig_eachSeries;
                            var ths = this;
                            process.nextTick(function ()
                            {
                                orig_eachSeries.call(ths, hs, cb);
                            });
                        };
                    };
                },
                client_function: client_function,
                skip_ready: true
            });

            it('should callback if already ended',
               expect_error('foo', true, 0));
        });

        if (!options.anon)
        {
            describe('public key change', function ()
            {
                setup(2,
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
                    separate_tokens: true
                });

                it('should close connection if public key changes', function (done)
                {
                    var mqs,
                        server_done = 0,
                        client_done = 0;

                    for (var info of connections.values())
                    {
                        if (info.hsdata[0] === 0)
                        {
                            mqs = info.mqserver;
                            break;
                        }
                    }

                    function check()
                    {
                        if ((server_done === 1) && (client_done === 1))
                        {
                            setTimeout(function ()
                            {
                                server.removeListener('disconnect', disconnect);
                                clients[1].mux.carrier.removeListener('end', end2);
                                done();
                            }, 1000);
                        }
                        else if ((server_done > 1) || (client_done > 1))
                        {
                            done(new Error('called too many times'));
                        }
                    }

                    function disconnect(mqserver, info)
                    {
                        expect(mqserver).to.equal(mqs);
                        server_done += 1;
                        check();
                    }

                    server.on('disconnect', disconnect);

                    function end()
                    {
                        client_done += 1;
                        check();
                    }

                    function end2()
                    {
                        client_done += 1;
                        check();
                    }

                    clients[0].mux.carrier.on('end', end);
                    clients[1].mux.carrier.on('end', end2);

                    priv_key = ursa.generatePrivateKey(2048, 65537);
                    server.authz.keystore.add_pub_key(uri, priv_key.toPublicPem('utf8'),
                    function (err, the_issuer_id, the_rev)
                    {
                        if (err)
                        {
                            return done(err);
                        }
                        
                        issuer_id = the_issuer_id;
                        rev = the_rev;
                    });
                });

                it('should not close connection if revision matches', function (done)
                {
                    var called = false,
                        old_rev = rev;

                    function snbc()
                    {
                        done(new Error('should not be called'));
                    }

                    setTimeout(function ()
                    {
                        expect(called).to.equal(true);
                        server.removeListener('disconnect', snbc);
                        clients[0].mux.carrier.removeListener('end', snbc);
                        clients[1].mux.carrier.removeListener('end', snbc);
                        done();
                    }, 1000);

                    server.on('disconnect', snbc);
                    clients[0].mux.carrier.on('end', snbc);
                    clients[1].mux.carrier.on('end', snbc);

                    var listeners = server.authz.keystore.listeners('change');
                    expect(listeners.length).to.equal(1);
                    server.authz.keystore.removeAllListeners('change');
                    server.authz.keystore.on('change', function change(uri, new_rev)
                    {
                        called = true;
                        var conn = server._connections.get(uri).values().next().value;
                        expect(conn.rev).to.equal(old_rev);
                        conn.rev = new_rev;
                        server.authz.keystore.removeListener('change', change);
                        listeners[0].apply(this, arguments);
                    });

                    priv_key = ursa.generatePrivateKey(2048, 65537);
                    server.authz.keystore.add_pub_key(uri, priv_key.toPublicPem('utf8'),
                    function (err, the_issuer_id, the_rev)
                    {
                        if (err)
                        {
                            return done(err);
                        }
                        
                        issuer_id = the_issuer_id;
                        rev = the_rev;
                    });
                });
            });

            describe('revision check error', function ()
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
                    before_connect_function: function ()
                    {
                        var orig_get_pub_key_by_uri = server.transport_ops[0].authz.keystore.get_pub_key_by_uri;

                        server.transport_ops[0].authz.keystore.get_pub_key_by_uri = function (uri, cb)
                        {
                            this.get_pub_key_by_uri = orig_get_pub_key_by_uri;
                            cb(new Error('dummy'));
                        };
                    },
                    skip_ready: true,
                    client_function: client_function
                });

                it('should warn on destroy if error occurs while checking revision', expect_error('dummy', false, 0));
            });

            describe('revision mismatch', function ()
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
                    before_connect_function: function ()
                    {
                        var orig_get_pub_key_by_uri = server.transport_ops[0].authz.keystore.get_pub_key_by_uri;

                        server.transport_ops[0].authz.keystore.get_pub_key_by_uri = function (uri, cb)
                        {
                            this.get_pub_key_by_uri = orig_get_pub_key_by_uri;
                            cb(null, null, 'foo');
                        };
                    },
                    skip_ready: true,
                    client_function: client_function
                });

                it('should warn on destroy if old revision', expect_error('uri revision has changed: ' + uri, false, 0));
            });

            describe('unknown uri on closed connection', function ()
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

                it("should warn if uri isn't known", function (done)
                {
                    var msg;

                    server.once('warning', function (err)
                    {
                        msg = err.message;
                    });

                    server.once('empty', function ()
                    {
                        expect(msg).to.equal('unknown uri on closed connection: ' + uri);
                        done();
                    });

                    server._connections.delete(uri);
                    clients[0].mux.carrier.end();
                });
            });
        }

        describe('stream hooks', function (done)
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

            it('should be able to throttle streams', function (done)
            {
                this.timeout(8000);

                var mqserver = connections.keys().next().value,
                    date_before_publish,
                    date_before_deliver;

                mqserver.on('publish_requested', function (topic, duplex, options, cb)
                {
                    var t = new Throttle({rate: 10}),
                        d = this.fsq.publish(topic, options, function (err)
                        {
                            if (err) { return done(err); }
                            expect(new Date() - date_before_publish).to.be.at.least(2000);
                            cb();
                        });

                    t.on('error', function (err)
                    {
                        d.emit('error', err);
                    });

                    duplex.pipe(t).pipe(d);
                });

                mqserver.on('message', function (stream, info, multiplex)
                {
                    var t = new Throttle({rate: 10}),
                        d = multiplex();

                    t.on('error', function (err)
                    {
                        d.emit('error', err);
                    });

                    date_before_deliver = new Date();
                    stream.pipe(t).pipe(d);
                });

                clients[0].subscribe('foo', function (s, info)
                {
                    expect(info.topic).to.equal('foo');
                    expect(info.single).to.equal(false);

                    read_all(s, function (v)
                    {
                        expect(new Date() - date_before_deliver).to.be.at.least(2000);
                        expect(v.toString()).to.equal('012345678901234567890');
                        done();
                    });
                }, function (err)
                {
                    if (err) { return done(err); }
                    date_before_publish = new Date();
                    clients[0].publish('foo').end('012345678901234567890');
                });
            });

            it('should be able to time-out publish streams', function (done)
            {
                var mqserver,
                    client_done = false,
                    server_done = false;

                function register()
                {
                    mqserver.on('publish_requested', function (topic, duplex, options, cb)
                    {
                        var d = this.fsq.publish(topic, options, function (err)
                        {
                            expect(err.message).to.equal('dummy');
                            cb(err);
                        });

                        setTimeout(function ()
                        {
                            d.emit('error', new Error('dummy'));
                        }, 1000);

                        duplex.pipe(d);
                    });
                }

                if (options.relay)
                {
                    server.once('connect', function (info)
                    {
                        mqserver = info.mqserver;
                        register();
                    });
                }
                else
                {
                    mqserver = connections.keys().next().value;
                    register();
                }

                server.once('disconnect', function (mqsrv)
                {
                    expect(mqsrv).to.equal(mqserver);
                    server_done = true;
                    if (client_done)
                    {
                        done();
                    }
                });

                clients[0].publish('foo', function (err)
                {
                    expect(err.message).to.equal('server error');
                    clients[0].mux.on('end', function ()
                    {
                        client_done = true;
                        if (server_done)
                        {
                            done();
                        }
                    });
                    connections.values().next().value.destroy();
                }).write('A');
            });

            it('should be able to time-out message streams', function (done)
            {
                var mqserver = connections.keys().next().value,
                    client_done = false,
                    server_done = false;

                mqserver.on('message', function (stream, info, multiplex)
                {
                    var ended = false;

                    stream.on('end', function ()
                    {
                        ended = true;
                    });

                    var d = multiplex();
                    stream.pipe(d);

                    setTimeout(function ()
                    {
                        expect(ended).to.equal(false);
                        stream.on('error', function (err)
                        {
                            expect(err.message).to.equal('dummy');
                        });
                        stream.on('end', function ()
                        {
                            connections.get(mqserver).destroy();
                        });
                        stream.on('readable', function ()
                        {
                            this.read();
                        });
                        d.emit('error', new Error('dummy'));
                    }, 1000);
                });

                clients[0].mux.on('end', function ()
                {
                    client_done = true;
                    if (server_done)
                    {
                        done();
                    }
                });

                clients[0].subscribe('foo', function (s, info)
                {
                    expect(info.topic).to.equal('foo');
                    expect(info.single).to.equal(false);
                }, function (err)
                {
                    if (err) { return done(err); }
                    clients[0].publish('foo', function (err)
                    {
                        if (err) { return done(err); }
                        server.once('disconnect', function (mqsrv)
                        {
                            expect(mqsrv).to.equal(mqserver);
                            server_done = true;
                            if (client_done)
                            {
                                done();
                            }
                        });
                    }).end(new Buffer(128*1024));
                });
            });

            it('should be able to limit data published', function (done)
            {
                var mqserver,
                    client_done = false,
                    server_done = false;

                function register()
                {
                    mqserver.on('publish_requested', function (topic, duplex, options, cb)
                    {
                        var p = new Transform(),
                            d = this.fsq.publish(topic, options, cb);

                        p.on('error', function (err)
                        {
                            d.emit('error', err);
                        });

                        var count = 0;

                        p._transform = function (chunk, enc, cont)
                        {
                            count += chunk.length;

                            if (count > 17000)
                            {
                                return cont(new Error('too much data'));
                            }

                            this.push(chunk);
                            cont();
                        };

                        duplex.pipe(p).pipe(d);
                    });
                }

                if (options.relay)
                {
                    server.once('connect', function (info)
                    {
                        mqserver = info.mqserver;
                        register();
                    });
                }
                else
                {
                    mqserver = connections.keys().next().value;
                    register();
                }

                server.once('disconnect', function (mqsrv)
                {
                    expect(mqsrv).to.equal(mqserver);
                    server_done = true;
                    if (client_done)
                    {
                        done();
                    }
                });

                if (is_transport('tcp'))
                {
                    clients[0].on('error', function (err)
                    {
                        expect(err.message).to.be.oneOf(
                            ['write EPIPE', 'read ECONNRESET']);
                    });
                }

                clients[0].mux.on('end', function ()
                {
                    client_done = true;
                    if (server_done)
                    {
                        done();
                    }
                });

                clients[0].publish('foo', function (err)
                {
                    expect(err.message).to.equal('server error');
                    connections.values().next().value.destroy();
                }).end(new Buffer(128 * 1024));
            });
        });

        describe('version check', function ()
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

                before_connect_function: function ()
                {
                    require('../lib/server').version += 1;
                },

                client_function: function (c, onconnect)
                {
                    c.on('error', function (err)
                    {
                        this.last_error = err;
                        onconnect();
                    });
                },

                skip_ready: true
            });

            it('should check version number', function (done)
            {
                function check_error()
                {
                    if (clients[0].last_error && server.last_warning)
                    {
                        expect(server.last_warning.message).to.equal('unsupported version: 1');
                        expect(clients[0].last_error.message).to.equal('unsupported version: 2');
                        require('../lib/server').version -= 1;
                        return done();
                    }

                    setTimeout(check_error, 500);
                }

                check_error();
            });
        });

        describe('client handshake length', function ()
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

                before_connect_function: function ()
                {
                    var client = require('../lib/client');
                    client.version_buffer_save = client.version_buffer;
                    client.version_buffer = new Buffer(2);
                },

                client_function: function (c, onconnect)
                {
                    c.on('error', function (err)
                    {
                        this.last_error = err;
                        onconnect();
                    });
                },

                skip_ready: true
            });

            it('server should check client handshake length', function (done)
            {
                function check_error()
                {
                    if (clients[0].last_error && server.last_warning)
                    {
                        expect(server.last_warning.message).to.equal('short handshake');
                        expect(clients[0].last_error.message).to.equal('Unexpected end of input');

                        var client = require('../lib/client');
                        client.version_buffer = client.version_buffer_save;
                        delete client.version_buffer_save;

                        return done();
                    }

                    setTimeout(check_error, 500);
                }

                check_error();
            });
        });

        describe('existing messages', function ()
        {
            var topic = crypto.randomBytes(64).toString('hex'),
                subscribe = {};
            subscribe[topic] = true;

            setup(2,
            {
                access_control: {
                    publish: {
                        allow: [topic],
                        disallow: []
                    },
                    subscribe: {
                        allow: [topic],
                        disallow: []
                    }
                },

                subscribe: subscribe,

                separate_tokens: true,
                series: true,
                same_issuer: true,

                client_ready: function (i, next)
                {
                    var client = this;

                    if (i === 0)
                    {
                        return client.subscribe(topic, function (s, info)
                        {
                            expect(info.single).to.equal(false);
                            expect(info.topic).to.equal(topic);
                            expect(info.existing).to.equal(false);

                            read_all(s, function (v)
                            {
                                expect(v.toString()).to.equal('bar');
                                next(null, client);
                            });
                        }, function (err)
                        {
                            if (err) { throw err; }
                            client.publish(topic, function (err)
                            {
                                if (err) { throw err; }
                            }).end('bar');
                        });
                    }

                    client.subscribe(topic, function (s, info)
                    {
                        this.s = s;
                        this.info = info;
                        next(null, this);
                    });
                }
            });

            it('should support subscribing to existing messages', function (done)
            {
                expect(clients[0].subscriptions).to.equal(undefined);
                var sub = {};
                sub[topic] = true;
                expect(clients[1].subscriptions).to.eql([sub]);

                expect(clients[1].info.single).to.equal(false);
                expect(clients[1].info.topic).to.equal(topic);
                expect(clients[1].info.existing).to.equal(true);

                read_all(clients[1].s, function (v)
                {
                    expect(v.toString()).to.equal('bar');
                    done();
                });
            });
        });

        if (options.extra)
        {
            describe('extra', function ()
            {
                options.extra(get_info, on_before);
            });
        }
    }

    describe(name, function ()
    {
        describe('main', function ()
        {
            run.call(this, config);
        });

        describe('filter', function ()
        {
            run.call(this, Object.assign(
            {
                only: function (get_info)
                {
                    get_info().setup(1,
                    {
                        access_control: {
                            publish: {
                                allow: ['foo', 'bar'],
                                disallow: []
                            },
                            subscribe: {
                                allow: ['foo', 'bar'],
                                disallow: []
                            }
                        }
                    });

                    it('should be able to filter handlers', function (done)
                    {
                        if (config.fsq) { return done(); }

                        // delay message until all streams are under high-water mark

                        get_info().clients[0].subscribe('bar', function (s)
                        {
                            var mqserver = get_info().connections.keys().next().value;
                            mqserver.bar_s = s;
                            // don't read so server is backed up
                            this.publish('foo', function (err)
                            {
                                if (err) { return done(err); }
                            }).end('hello');
                        }, function (err)
                        {
                            if (err) { return done(err); }
                            get_info().clients[0].subscribe('foo', function (s)
                            {
                                read_all(s, function (v)
                                {
                                    expect(v.toString()).to.equal('hello');
                                    done();
                                });
                            }, function (err)
                            {
                                if (err) { return done(err); }
                                get_info().clients[0].publish('bar', function (err)
                                {
                                    if (err) { return done(err); }
                                }).end(new Buffer(128 * 1024));
                            });
                        });
                    });
                },

                handler_concurrency: 1,

                filter: function (info, handlers, cb)
                {
                    if (info.topic === 'bar')
                    {
                        return cb(null, true, handlers);
                    }

                    for (var h of handlers)
                    {
                        if (h.mqlobber_server)
                        {
                            for (var d of h.mqlobber_server.mux.duplexes.values())
                            {
                                if (d._writableState.length >=
                                    d._writableState.highWaterMark)
                                {
                                    // drain 'bar' stream on client
                                    var bar_s = h.mqlobber_server.bar_s;
                                    if (bar_s)
                                    {
                                        read_all(bar_s);
                                        h.mqlobber_server.bar_s = null;
                                    }

                                    return cb(null, false);
                                }
                            }
                        }
                    }

                    cb(null, true, handlers);
                }
            }, config));
        });

        describe('fastest writable', function ()
        {
            run.call(this, Object.assign(
            {
                only: function (get_info)
                {
                    get_info().setup(2,
                    {
                        access_control: {
                            publish: {
                                allow: ['foo'],
                                disallow: []
                            },
                            subscribe: {
                                allow: ['foo', '#'],
                                disallow: []
                            }
                        }
                    });

                    it('should support setting custom data on message info and stream', function (done)
                    {
                        if (config.fsq) { return done(); }

                        var message0_called = false,
                            message1_called = false,
                            laggard0_called = false,
                            laggard1_called = false,
                            buf = new Buffer(100 * 1024),
                            mqservers = {},
                            prefixes = {};

                        buf.fill('a');

                        for (var info of get_info().connections.values())
                        {
                            mqservers[info.hsdata[0]] = info.mqserver;
                            prefixes[info.hsdata[0]] = info.prefixes;
                        }

                        function check(msg_stream, info, duplex)
                        {
                            expect(info.topic).to.equal(prefixes[0][0] + 'foo');
                            expect(msg_stream.fastest_writable === undefined).to.equal(info.count === 0 ? true : false);
                            info.count += 1;

                            if (!msg_stream.fastest_writable)
                            {
                                msg_stream.fastest_writable = new FastestWritable(
                                {
                                    emit_laggard: true
                                });
                                msg_stream.pipe(msg_stream.fastest_writable);
                            }

                            msg_stream.fastest_writable.add_peer(duplex);

                            if (info.count === info.num_handlers)
                            {
                                // make fastest_writable enter waiting state
                                msg_stream.fastest_writable.write(buf);
                            }
                        }

                        mqservers[0].on('message', function (msg_stream, info, multiplex)
                        {
                            expect(message0_called).to.equal(false);
                            message0_called = true;
                            var duplex = multiplex();
                            check(msg_stream, info, duplex);
                            duplex.on('laggard', function ()
                            {
                                laggard0_called = true;
                            });
                        });

                        mqservers[1].on('message', function (msg_stream, info, multiplex)
                        {
                            expect(message1_called).to.equal(false);
                            message1_called = true;
                            var null_stream = new NullStream();
                            null_stream.on('laggard', function ()
                            {
                                laggard1_called = true;
                            });
                            check(msg_stream, info, null_stream);
                        });

                        get_info().clients[0].subscribe('foo', function (s, info)
                        {
                            expect(info.topic).to.equal('foo');
                            read_all(s, function (v)
                            {
                                expect(v.toString()).to.equal(buf.toString() + 'bar');
                                setTimeout(function ()
                                {
                                    expect(laggard0_called).to.equal(false);
                                    expect(laggard1_called).to.equal(true);
                                    done();
                                }, 2000);
                            });
                        }, function (err)
                        {
                            if (err) { return done(err); }
                            get_info().clients[1].subscribe('#', function (s, info)
                            {
                                done(new Error('should not be called'));
                            }, function (err)
                            {
                                if (err) { return done(err); }
                                get_info().clients[0].publish('foo').end('bar');
                            });
                        });
                    });
                },

                filter: function (info, handlers, cb)
                {
                    info.num_handlers = handlers.size;
                    info.count = 0;
                    cb(null, true, handlers);
                }
            }, config));
        });
    });
};
