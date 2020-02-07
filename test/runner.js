/*eslint-env node, mocha */
"use strict";

var centro = require('..'),
    pipeline = centro.pipeline,
    CentroServer = centro.CentroServer,
    util = require('util'),
    crypto = require('crypto'),
    jsjws = require('jsjws'),
    expect = require('chai').expect,
    async = require('async'),
    path = require('path'),
    rimraf = require('rimraf'),
    Transform = require('stream').Transform,
    Writable = require('stream').Writable,
    read_all = require('./read_all'),
    uri = 'mailto:dave@davedoesdev.com',
    uri2 = 'mailto:david@davedoesdev.com';
/*
var EventEmitter = require('events').EventEmitter;
var orig_emit = EventEmitter.prototype.emit;
EventEmitter.prototype.emit = function (type, ...args)
{
    if (type === 'error')
    {
        console.log("ERROR", args, this);
    }
    return orig_emit.apply(this, arguments);
};
*/
process.on('unhandledRejection', (reason, p) => {
    if (reason.message !== 'async skip; aborting execution')
    {
        // eslint-disable-next-line no-console
        console.error('Unhandled Rejection at:', p, 'reason:', reason);
        process.exit(1);
    }
});

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
        name = config.transport.name ||
               config.transport.server ||
               config.transport;
    }
    else
    {
        name = config.transport[0].name ||
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

    config.allowed_algs = ['PS256'];
    config.max_tokens = 2;
    // Note the following requires the test to be run with
    // --max-http-header-size=32768
    config.max_token_length = 16 * 1024;
    config.maxSize = config.max_token_length;
    config.send_expires = true;
    config.send_size = true;
    config.multi_ttl = 10 * 60 * 1000;
    config.max_topic_length = undefined;
    config.max_publications = undefined;
    config.authorize_config = Object.assign({
        verbose: false // change to true to track pub key changes
    }, config.authorize_config);

    if (process.env.SPLIT_TOPIC_AT)
    {
        config.split_topic_at = parseInt(process.env.SPLIT_TOPIC_AT);
    }

    function is_transport(n)
    {
        if (n === 'tcp')
        {
            return name.lastIndexOf('net', 0) === 0 ||
                   name.lastIndexOf('tls', 0) === 0;
        }

        return name.lastIndexOf(n, 0) === 0;
    }

    function run(config)
    {
        /* jshint validthis: true */
        this.timeout((config.test_timeout || 60000) *
                     (is_transport('primus') ? 10 : 1));

        var server, clients,
            priv_key, priv_key2,
            issuer_id, issuer_id2,
            rev,
            connections = new Map();

        function get_connid_from_mqserver(mqserver)
        {
            for (var entry of connections)
            {
                if (entry[1].mqserver === mqserver)
                {
                    return entry[0];
                }
            }
        }

        function on_pre_after(cb)
        {
            if (options.on_pre_after)
            {
                return options.on_pre_after(config, cb);
            }

            cb();
        }

        function on_before(cb)
        {
            if (this && this.timeout)
            {
                this.timeout(60000);
            }

            var ths = this;

            presence_topics.clear();
            pending_presence_topics.clear();

            function start2()
            {
                server = new centro.CentroServer(config);

                server.on('pre_connect', function (info)
                {
                    connections.set(info.connid, info);
                });

                server.on('connect', function (connid, hsdata)
                {
                    var conn = connections.get(connid);
                    if (conn)
                    {
                        pending_presence_topics.add('join.' + connid);
                        pending_presence_topics.add('leave.' + connid);
                        pending_presence_topics.add('ready.all.' + connid);
                        conn.hsdata = hsdata;
                    }
                });

                server.on('disconnect', function (connid)
                {
                    connections.delete(connid);
                });

                if (config.before_server_ready)
                {
                    config.before_server_ready.call(ths, get_info);
                }

                server.on('ready', function ()
                {
                    if (options.anon)
                    {
                        if (ths && ths.test_should_skip)
                        {
                            return ths.skip();
                        }

                        return cb();
                    }

                    priv_key = jsjws.generatePrivateKey(2048, 65537);
                    server.authz.keystore.add_pub_key(uri, priv_key.toPublicPem('utf8'),
                    function (err, the_issuer_id, the_rev)
                    {
                        if (err)
                        {
                            return cb(err);
                        }
                        
                        issuer_id = the_issuer_id;
                        rev = the_rev;

                        priv_key2 = jsjws.generatePrivateKey(2048, 65537);
                        server.authz.keystore.add_pub_key(uri2, priv_key2.toPublicPem('utf8'),
                        function (err, the_issuer_id, unused_the_rev)
                        {
                            if (err)
                            {
                                return cb(err);
                            }
                            
                            issuer_id2 = the_issuer_id;

                            if (ths && ths.test_should_skip)
                            {
                                return ths.skip();
                            }

                            cb();
                        });
                    });
                });

                server.on('warning', function (err)
                {
                    if ((err.message !== 'carrier stream ended before end message received') &&
                        (err.message !== 'carrier stream finished before duplex finished') &&
                        (err.message !== 'This socket has been ended by the other party') &&
                        (err.message !== 'write after end') &&
                        (err.message !== 'backoff') &&
                        (err.message !== 'This socket is closed.') &&
                        (err.message !== 'This socket is closed') &&
                        (err.message !== 'Cannot call write after a stream was destroyed') &&
                        !err.message.startsWith('uri revision change'))
                    {
                        // eslint-disable-next-line no-console
                        console.warn(err.message);
                        if (!this.warnings)
                        {
                            this.warnings = [];
                        }
                        this.warnings.push(err.message);
                        this.last_warning = err;
                    }
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

        function on_after(cb4)
        {
            if (this && this.timeout)
            {
                this.timeout(60000);
            }

            function cb3(err)
            {
                if (err)
                {
                    return cb4(err);
                }

                if (options.on_after)
                {
                    return options.on_after(config, cb4);
                }

                cb4();
            }

            function cb2(err)
            {
                if (err)
                {
                    return cb3(err);
                }

                server.close(function ()
                {
                    if (config.fsq)
                    {
                        expect(server.fsq.stopped).to.equal(false);
                        config.fsq.stop_watching(cb3);
                    }
                    else
                    {
                        expect(server.fsq.stopped).to.equal(true);
                        cb3();
                    }
                });
            }

            function cb(err)
            {
                if (err)
                {
                    return cb2(err);
                }

                on_pre_after(cb2);
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

                server.authz.keystore.remove_pub_key(uri2, cb);
            });
        }

        after(on_after);

        after(function (cb)
        {
            var fsq_dir = path.join(path.dirname(require.resolve('qlobber-fsq')), 'fsq');
            rimraf(fsq_dir, cb);
        });

        function setup(n, opts)
        {
            if (options.on_before_each)
            {
                beforeEach(function (cb)
                {
                    options.on_before_each(config, cb);
                });
            }

            beforeEach(function (cb)
            {
                server.warnings = [];
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
                    centro.stream_auth = function (stream, unused_config)
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
                    opts.before_connect_function.call(this);
                }

                var token = new jsjws.JWT().generateJWTByKey(
                {
                    alg: opts.alg || 'PS256'
                },
                {
                    iss: issuer_id,
                    access_control: access_control[0],
                    ack: opts.ack,
                    presence: opts.presence,
                }, token_exp, priv_key);

                var token2 = new jsjws.JWT().generateJWTByKey(
                {
                    alg: opts.alg || 'PS256'
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
                        token: opts.no_token ? (options.anon ? undefined : '') :
                               opts.too_many_tokens ? [token, token2, token] :
                               opts.long_token ? new Array(config.max_token_length + 2).join('A') :
                               opts.duplicate_tokens ? [token, token] :
                               i % 2 === 0 || (options.anon && !opts.separate_tokens) ? token :
                               opts.separate_tokens ? token2 : [token, token2],
                        handshake_data: Buffer.from([i]),
                        max_topic_length: opts.max_topic_length,
                        max_words: opts.max_words,
                        max_wildcard_somes: opts.max_wildcard_somes,
                        max_open: opts.max_open,
                        test_config: config
                    }, server, function (err, c)
                    {
                        if (err)
                        {
                            return next(err);
                        }

                        if (opts.client_function)
                        {
                            opts.client_function(c, i, onconnect);
                        }

                        if (((typeof opts.skip_ready === 'boolean') &&
                             opts.skip_ready) ||
                            ((typeof opts.skip_ready === 'number') &&
                             (opts.skip_ready === i)) ||
                            opts.end_immediately)
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

                        c.on('warning', function (err)
                        {
                            if (err.message !== c.last_err_message)
                            {
                                // eslint-disable-next-line no-console
                                console.warn(err.message);
                            }
                            c.last_err_message = err.message;
                        });
                    });
                }, function (err, cs)
                {
                    if (opts.end_immediately)
                    {
                        centro.stream_auth = orig_stream_auth;
                        centro.separate_auth = orig_separate_auth;
                    }

                    clients = cs;

                    if (err)
                    {
                        if (opts.on_connect_error)
                        {
                            opts.on_connect_error(err);
                            return cb();
                        }

                        return cb(err);
                    }

                    if (opts.end_immediately &&
                        !is_transport('primus') &&
                        !is_transport('node_http2'))
                    {
                        server.removeListener('connect', onconnect);
                        return setTimeout(cb, 1000);
                    }

                    if (opts.skip_connect || (connected === n))
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
                    var called = false;

                    function cb2()
                    {
                        if (!called)
                        {
                            if (c && is_transport('node_http2-duplex'))
                            {
                                c.mux.carrier.destroy();
                            }
                            called = true;
                            cb();
                        }
                    }

                    if (!c ||
                        c.mux.carrier._readableState.ended ||
                        c.mux.carrier.destroyed)
                    {
                        return cb2();
                    }
                    c.mux.carrier.on('close', cb2);
                    c.mux.carrier.on('end', cb2);
                    c.mux.carrier.end();
                }, function ()
                {
                    if (server._connids.size === 0)
                    {
                        return empty();
                    }

                    if (options.relay)
                    {
                        for (var dstroy of Array.from(server._connids.values()))
                        {
                            dstroy();
                        }
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
                setup: setup,
                client_function: client_function,
                expect_error: expect_error,
                attach_extension: attach_extension,
                detach_extension: detach_extension,
                get_connid_from_mqserver: get_connid_from_mqserver,
                on_pre_after: on_pre_after
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
                            if (err) { return done(err); }
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
                                if (err) { return done(err); }
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
                                    if (err) { return done(err); }
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

                for (var info of connections.values())
                {
                    regreq(info.mqserver);
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

        describe('access control (no single messages)', function ()
        {
            setup(1,
            {
                access_control: {
                    publish: {
                        allow: ['foo'],
                        disallow: [],
                        disallow_single: true
                    },
                    subscribe: {
                        allow: ['foo'],
                        disallow: []
                    }
                }
            });

            it('should be able to disallow publishing messages to single subscriber', function (done)
            {
                var warnings = [], blocked = [];

                function warning(err)
                {
                    var msg = err.message;
                    if ((msg !== 'carrier stream finished before duplex finished') &&
                        (msg !== 'carrier stream ended before end message received'))
                    {
                        warnings.push(msg);
                    }
                }
                server.on('warning', warning);

                function regblock(info)
                {
                    info.access_control.once('publish_blocked',
                    function (topic, mqserver)
                    {
                        expect(mqserver).to.equal(info.mqserver);
                        blocked.push('publish ' + topic);
                    });
                }

                clients[0].subscribe('foo', function (s, info)
                {
                    expect(info.topic).to.equal('foo');
                    expect(info.single).to.equal(false);

                    read_all(s, function (v)
                    {
                        expect(v.toString()).to.equal('bar');
                        server.removeListener('warning', warning);
                        var topic = get_info().connections.values().next().value.prefixes[0] + 'foo',
                            expected_warnings = ['blocked publish (single) to topic: ' + topic];
                        if (options.relay)
                        {
                            expected_warnings.push('server error');
                        }
                        expected_warnings.push('unexpected data');
                        expect(warnings).to.eql(expected_warnings);
                        expect(blocked).to.eql(['publish ' + topic]);
                        done();
                    });
                }, function (err)
                {
                    if (err) { return done(err); }

                    for (var info of connections.values())
                    {
                        regblock(info);
                    }

                    if (options.relay)
                    {
                        server.once('pre_connect', regblock);
                    }

                    clients[0].publish('foo', {single: true}, function (err)
                    {
                        expect(err.message).to.equal('server error');
                        clients[0].publish('foo', function (err)
                        {
                            if (err) { return done(err); }
                        }).end('bar');
                    }).end('bar');
                });
            });
        });

        describe('access control (no multi messages)', function ()
        {
            setup(1,
            {
                access_control: {
                    publish: {
                        allow: ['foo'],
                        disallow: [],
                        disallow_multi: true
                    },
                    subscribe: {
                        allow: ['foo'],
                        disallow: []
                    }
                }
            });

            it('should be able to disallow publishing messages to multiple subscribers', function (done)
            {
                var warnings = [], blocked = [];

                function warning(err)
                {
                    var msg = err.message;
                    if ((msg !== 'carrier stream finished before duplex finished') &&
                        (msg !== 'carrier stream ended before end message received'))
                    {
                        warnings.push(msg);
                    }
                }
                server.on('warning', warning);

                function regblock(info)
                {
                    info.access_control.once('publish_blocked',
                    function (topic, mqserver)
                    {
                        expect(mqserver).to.equal(info.mqserver);
                        blocked.push('publish ' + topic);
                    });
                }

                clients[0].subscribe('foo', function (s, info, ack)
                {
                    expect(info.topic).to.equal('foo');
                    expect(info.single).to.equal(true);

                    read_all(s, function (v)
                    {
                        expect(v.toString()).to.equal('bar');
                        server.removeListener('warning', warning);
                        var topic = get_info().connections.values().next().value.prefixes[0] + 'foo',
                            expected_warnings = ['blocked publish (multi) to topic: ' + topic];
                        if (options.relay)
                        {
                            expected_warnings.push('server error');
                        }
                        expected_warnings.push('unexpected data');
                        expect(warnings).to.eql(expected_warnings);
                        expect(blocked).to.eql(['publish ' + topic]);
                        ack();
                        done();
                    });
                }, function (err)
                {
                    if (err) { return done(err); }

                    for (var info of connections.values())
                    {
                        regblock(info);
                    }

                    if (options.relay)
                    {
                        server.once('pre_connect', regblock);
                    }

                    clients[0].publish('foo', function (err)
                    {
                        expect(err.message).to.equal('server error');
                        clients[0].publish('foo', {single: true}, function (err)
                        {
                            if (err) { return done(err); }
                        }).end('bar');
                    }).end('bar');
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
                        if (blocked === 1)
                        {
                            setTimeout(done, 1000);
                        }
                        else if (blocked > connections.size)
                        {
                            done(new Error('called too many times'));
                        }
                    });
                }
               
                clients[0].subscribe('foo.bar', function (unused_s, unused_info)
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

                        for (var info of connections.values())
                        {
                            regblock(info);
                        }

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

                        read_all(s, function (v)
                        {
                            expect(v.length).to.equal(0);
                            done();
                        });
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
                    clients[0].on('warning', function (err)
                    {
                        expect(err.message).to.equal('carrier stream ended before end message received');
                    });

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

                        var mqserver = connections.values().next().value.mqserver;

                        mqserver.subscribe('foo', function (err)
                        {
                            if (err) { return done(err); }

                            clients[0]._matcher.add('foo', function (s, info, done)
                            {
                                read_all(s, function ()
                                {
                                    done();
                                });
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
                    return this.subscribe('join.*', function (s, info, ack)
                    {
                        if (presence_topics.has(info.topic)) { return read_all(s); }
                        expect(info.single).to.equal(single);
                        if (ttl)
                        {
                            expect(info.expires).to.be.at.most(new Date().getTime() / 1000 + ttl);
                        }
                        read_all(s, function (v)
                        {
                            ack();
                            expect(v.toString()).to.equal(typeof(data) === 'string' ? data : 'someone joined');
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
                    clients[0].on('error', function (err)
                    {
                        expect(err.message).to.equal('carrier stream finished before duplex finished');
                    });

                    clients[1].on('error', function (err)
                    {
                        expect(err.message).to.equal('carrier stream finished before duplex finished');
                    });

                    clients[0].subscribe('ready.all.*', function (s, info)
                    {
                        if (presence_topics.has(info.topic)) { return read_all(s); }

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
                            if (presence_topics.has(info.topic)) { return read_all(s); }

                            if (!options.relay)
                            {
                                expect(info.topic).to.equal('leave.' + clients[0].self);
                            }

                            expect(info.single).to.equal(false);

                            read_all(s, function (v)
                            {
                                expect(v.toString()).to.equal('someone left');
                                clients[1].unsubscribe('leave.*', undefined, pdone(done));
                            });
                        }, function (err)
                        {
                            if (err) { return done(err); }
                            clients[1].subscribe('ready.all.*', function (s, info)
                            {
                                if (presence_topics.has(info.topic)) { return read_all(s); }

                                if (!options.relay)
                                {
                                    expect(info.topic).to.equal('ready.all.' + clients[0].self);
                                }

                                expect(info.single).to.equal(false);

                                read_all(s, function (v)
                                {
                                    expect(v.toString()).to.equal('bar');
                                    if (!options.relay)
                                    {
                                        setTimeout(function ()
                                        {
                                            clients[0].mux.carrier.end();
                                        }, 500);
                                    }
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

                clients[0].on('error', function (err)
                {
                    expect(err.message).to.equal('carrier stream finished before duplex finished');
                });

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

                for (var info of connections.values())
                {
                    regreq(info.mqserver);
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
                    clients[0].on('error', function (err)
                    {
                        expect(err.message).to.be.oneOf([
                            'carrier stream finished before duplex finished',
                            'peer error'
                        ]);
                    });

                    clients[1].on('error', function (err)
                    {
                        expect(err.message).to.be.oneOf([
                            'carrier stream finished before duplex finished',
                            'peer error'
                        ]);
                    });

                    clients[0].subscribe('ready.all.*', function (s, info)
                    {
                        if (presence_topics.has(info.topic)) { return read_all(s); }

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
                            if (presence_topics.has(info.topic)) { return read_all(s); }

                            if (!options.relay)
                            {
                                expect(info.topic).to.equal('leave.' + clients[0].self);
                            }

                            expect(info.single).to.equal(false);

                            read_all(s, function (v)
                            {
                                expect(v.toString()).to.equal('someone left');
                                expect(info.expires).to.be.at.most(new Date().getTime() / 1000 + 2);
                                clients[1].unsubscribe('leave.*', undefined, pdone(done));
                            });
                        }, function (err)
                        {
                            if (err) { return done(err); }
                            clients[1].subscribe('ready.all.*', function (s, info)
                            {
                                if (presence_topics.has(info.topic)) { return read_all(s); }

                                if (!options.relay)
                                {
                                    expect(info.topic).to.equal('ready.all.' + clients[0].self);
                                }

                                expect(info.single).to.equal(false);

                                read_all(s, function (v)
                                {
                                    expect(v.toString()).to.equal('bar');
                                    if (!options.relay)
                                    {
                                        setTimeout(function ()
                                        {
                                            clients[0].mux.carrier.end();
                                        }, 500);
                                    }
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
                    clients[0].on('error', function (err)
                    {
                        expect(err.message).to.equal('carrier stream finished before duplex finished');
                    });

                    clients[1].on('error', function (err)
                    {
                        expect(err.message).to.equal('carrier stream finished before duplex finished');
                    });

                    clients[0].subscribe('ready.all.*', function (s, info)
                    {
                        if (presence_topics.has(info.topic)) { return read_all(s); }

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
                            if (presence_topics.has(info.topic)) { return read_all(s); }

                            if (!options.relay)
                            {
                                expect(info.topic).to.equal('leave.' + clients[0].self);
                            }

                            expect(info.single).to.equal(true);

                            read_all(s, function (v)
                            {
                                ack();
                                expect(v.toString()).to.equal('someone left');
                                clients[1].unsubscribe('leave.*', undefined, pdone(done));
                            });
                        }, function (err)
                        {
                            if (err) { return done(err); }
                            clients[1].subscribe('ready.all.*', function (s, info)
                            {
                                if (presence_topics.has(info.topic)) { return read_all(s); }

                                if (!options.relay)
                                {
                                    expect(info.topic).to.equal('ready.all.' + clients[0].self);
                                }

                                expect(info.single).to.equal(false);

                                read_all(s, function (v)
                                {
                                    expect(v.toString()).to.equal('bar');
                                    if (!options.relay)
                                    {
                                        setTimeout(function ()
                                        {
                                            clients[0].mux.carrier.end();
                                        }, 500);
                                    }
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
                    clients[0].on('error', function (err)
                    {
                        expect(err.message).to.equal('carrier stream finished before duplex finished');
                    });

                    clients[1].on('error', function (err)
                    {
                        expect(err.message).to.equal('carrier stream finished before duplex finished');
                    });

                    clients[0].subscribe('ready.all.*', function (s, info)
                    {
                        if (presence_topics.has(info.topic)) { return read_all(s); }

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
                            if (presence_topics.has(info.topic)) { return read_all(s); }

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
                                if (presence_topics.has(info.topic)) { return read_all(s); }

                                if (!options.relay)
                                {
                                    expect(info.topic).to.equal('ready.all.' + clients[0].self);
                                }

                                expect(info.single).to.equal(false);

                                read_all(s, function (v)
                                {
                                    expect(v.toString()).to.equal('');
                                    if (!options.relay)
                                    {
                                        setTimeout(function ()
                                        {
                                            clients[0].mux.carrier.end();
                                        }, 500);
                                    }
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
                    if (is_transport('node_http2-duplex'))
                    {
                        if (err.message !== 'Stream prematurely closed')
                        {
                            expect(err.response.status).to.equal(404);
                        }
                    }
                    else if (is_transport('in-mem'))
                    {
                        expect(err.message).to.equal('dummy');
                    }
                });

                for (var info of connections.values())
                {
                    info.mqserver.mux.carrier.emit('error', new Error('dummy'));
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
                    expect(topic).to.equal(info.prefixes[0] + 'foo');
                    stream.emit('error', new Error('dummy2'));
                    done();
                }

                function connect(connid)
                {
                    connections.get(connid).mqserver.on('publish_requested', pubreq);
                }

                server.once('connect', connect);

                for (var info of connections.values())
                {
                    info.mqserver.on('publish_requested', pubreq);
                }

                if (is_transport('tcp') || is_transport('node_http2'))
                {
                    clients[0].on('error', function (err)
                    {
                        expect(err.message).to.equal('write after end');
                    });
                }

                clients[0].publish('foo', function (err)
                {
                    expect(err.message).to.equal('server error');
                    expect(warned).to.equal(true);
                    server.removeListener('connect', connect);
                    done();
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
                    }
                    else if (count > 2)
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

                clients[0].subscribe('foo', function ()
                {
                    done(new Error('should not be called'));
                }, function (err)
                {
                    if (err) { return done(err); }

                    for (var info of connections.values())
                    {
                        regmsg(info.mqserver);
                    }

                    clients[0].publish('foo', function (err)
                    {
                        if (err &&
                            (err.message !== 'carrier stream finished before duplex finished') &&
                            (err.message !== 'carrier stream ended before end message received') &&
                            (err.message !== 'closed'))
                        {
                            return done(err);
                        }
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
                client_function: function (c, i, onconnect)
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
                var is_done = false;

                function done2()
                {
                    if (!is_done)
                    {
                        is_done = true;
                        return done();
                    }
                }

                function check_error(err)
                {
                    if (err.message === 'carrier stream finished before duplex finished')
                    {
                        if (is_transport('primus') || is_transport('node_http2_http'))
                        {
                            return done2();
                        }
                        return;
                    }

                    expect(err.message).to.be.oneOf([
                        'carrier stream ended before end message received',
                        'read ECONNRESET'
                    ]);

                    done2();
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
                        delay()(Buffer.from([0, 1, 2]));
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
                client_function: function (c, i, onconnect)
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
                        delay()(Buffer.from(JSON.stringify(
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
                client_function: function (c, i, onconnect)
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
                    expect(err.message).to.equal('data should NOT have additional properties');
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

                        if (options.relay)
                        {
                            server.once('pre_connect', regblock);
                        }
                    }
     
                    clients[t[0]].subscribe(t[1], t[2], function (unused_s, unused_info, unused_cb)
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
                            clients[t[0]].subscribe(t[1], t[2], function sub(s, info, unused_cb)
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
                                server.once('pre_connect', regblock);
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
                    ended = false,
                    expired = false;

                function check()
                {
                    if (empty && ended && expired)
                    {
                        done();
                    }
                }

                server.once('empty', function ()
                {
                    empty = true;
                    check();
                });

                server.once('expired', function (connid)
                {
                    expired = true;
                    expect(connid).to.equal(clients[0].self);
                    check();
                });

                clients[0].mux.on('end', function ()
                {
                    ended = true;
                    check();
                });
            });
        });

        if (!options.anon)
        {
            describe('token expiry (before connect event)', function ()
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
                    ttl: 2,
                    before_connect_function: function ()
                    {
                        var orig_get_pub_key_by_uri = server.transport_ops[0].authz.keystore.get_pub_key_by_uri;

                        server.transport_ops[0].authz.keystore.get_pub_key_by_uri = function (unused_uri, unused_cb)
                        {
                            this.get_pub_key_by_uri = orig_get_pub_key_by_uri;
                        };
                    },
                    skip_ready: true,
                    skip_connect: true
                });

                it('should close connection when token expires', function (done)
                {
                    var empty = false,
                        ended = false,
                        expired = false;

                    function unexpected()
                    {
                        done(new Error('should not be called'));
                    }
                    server.on('connect', unexpected);

                    function check()
                    {
                        if (empty && ended && expired)
                        {
                            server.removeListener('connect', unexpected);
                            done();
                        }
                    }

                    server.once('empty', function ()
                    {
                        empty = true;
                        check();
                    });

                    server.once('expired', function ()
                    {
                        expired = true;
                        check();
                    });

                    clients[0].mux.on('end', function ()
                    {
                        ended = true;
                        check();
                    });

                    clients[0].on('error', function (err)
                    {
                        expect(err.message).to.be.oneOf([
                            'carrier stream finished before duplex finished',
                            'carrier stream ended before end message received',
                            'Stream prematurely closed'
                        ]);
                    });
                });
            });
        }

        function client_function(c, i, onconnect)
        {
            c.errors = [];

            c.on('error', function (err)
            {
                this.errors.push(err);

                if (err.response && is_transport('node_http2-duplex'))
                {
                    expect(err.response.status).to.equal(404);
                }

                onconnect();
            });

            c.on('ready', function ()
            {
                this.ready = true;
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
                        ths.terminate(); // otherwise Primus closes after a timeout
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

        function expect_error(msg, ignore_server, code, n, cb)
        {
            if ((code !== 0) && !code)
            {
                code = 401;
            }

            n = n || 0;

            return function (done)
            {
                var ths = this;

                function check_errors()
                {
                    if (!ignore_server)
                    {
                        if ((msg === 'token too long') &&
                            (!server.last_warning ||
                             (server.last_warning.message === 'Parse Error')))
                        {
                            if (server.last_warning)
                            {
                                expect(server.last_warning.code).to.equal('HPE_HEADER_OVERFLOW');
                            }
                        }
                        else
                        {
                            expect(server.last_warning.statusCode).to.equal(
                                code === 401 ? code : undefined);
                            expect(server.last_warning.authenticate).to.equal(
                                code === 401 ? 'Bearer realm="centro"' : undefined);
                        }
                    }

                    if (clients[n])
                    {
                        var errors = clients[n].errors;

                        if (errors.length < 1)
                        {
                            return false;
                        }

                        if ((typeof ignore_server !== 'number') &&
                            !is_transport('primus'))
                        {
                            if (is_transport('tls') ||
                                is_transport('net') ||
                                (process.platform === 'win32'))
                            {
                                expect(errors[0].message).to.be.oneOf([
                                    msg,
                                    'carrier stream ended before end message received',
                                    'carrier stream finished before duplex finished',
                                    'write ECONNABORTED',
                                    'read ECONNRESET',
                                    'write EPIPE'
                                ]);
                            }
                            else
                            {
                                expect(errors[0].message).to.equal(msg);
                            }
                        }
                        else
                        {
                            expect(errors[0].message).to.be.oneOf(
                            [
                                msg,
                                'socket hang up',
                                'write EPIPE',
                                'carrier stream ended before end message received',
                                'carrier stream finished before duplex finished',
                                'stream.push() after EOF',
                                'unexpected response',
                                'write ECONNABORTED',
                                'read ECONNRESET',
                                'write ECONNRESET',
                                'Client network socket disconnected before secure TLS connection was established',
                                'closed'
                            ]);
                        }

                        if (is_transport('primus') && (code !== 0))
                        {
                            if (errors.length < 2)
                            {
                                return false;
                            }

                            if ((errors[0].message === 'socket hang up') ||
                                (errors[0].message === 'read ECONNRESET') ||
                                (errors[0].message === 'Client network socket disconnected before secure TLS connection was established'))
                            {
                                for (var i = 1; i < errors.length - 1; i += 1)
                                {
                                    expect(errors[i].message).to.equal(errors[0].message);
                                }

                                if (errors[errors.length - 1].message === errors[0].message)
                                {
                                    return false;
                                }

                                expect(errors[errors.length - 1].message).to.equal('carrier stream ended before end message received');
                            }
                            else if (errors.length < 4)
                            {
                                return false;
                            }
                            else if (errors.length > 4)
                            {
                                if (errors[4].message === 'carrier stream finished before duplex finished')
                                {
                                    return false;
                                }
                                done(new Error('too many errors'));
                                return false;
                            }
                            else
                            {
                                expect(errors[0].message).to.equal('unexpected response');

                                if ((msg === 'token too long') &&
                                    (!server.last_warning ||
                                     (server.last_warning.message === 'Parse Error')))
                                {
                                    expect(errors[0].statusCode).to.equal(400);
                                }
                                else
                                {
                                    expect(errors[0].statusCode).to.equal(code);
                                    expect(errors[0].authenticate).to.equal(
                                        code == 401 ? 'Bearer realm="centro"' : undefined);
                                    expect(errors[0].data).to.equal('{"error":"' + msg + '"}');
                                }

                                expect(errors[1].message).to.equal('WebSocket was closed before the connection was established');
                                expect(errors[2].message).to.equal('WebSocket was closed before the connection was established');
                                expect(errors[3].message).to.equal('carrier stream ended before end message received');
                            }
                        }
                        else if (errors.length > 2)
                        {
                            done(new Error('too many errors'));
                            return false;
                        }
                        else if (errors.length === 2)
                        {
                            expect(errors[1].message).to.be.oneOf(
                            [
                                'write EPIPE',
                                'carrier stream ended before end message received',
                                'carrier stream finished before duplex finished',
                                'read ECONNRESET'
                            ]);
                        }
                    }

                    if (cb)
                    {
                        cb.call(ths, done);
                    }
                    else
                    {
                        done();
                    }

                    return true;
                }

                if (!check_errors())
                {
                    clients[n].on('error', check_errors);
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
            if (options.anon)
            {
                setup(1, { no_token: true });

                it('should publish and subscribe', function (done)
                {
                    clients[0].subscribe('foo', function (s, info)
                    {
                        expect(info.topic).to.equal('foo');
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
            }
            else
            {
                setup(1,
                {
                    no_token: true,
                    skip_ready: true,
                    client_function: client_function
                });

                it('should fail to authorize', expect_error('no tokens'));
            }
        });

        describe('immediate eos', function ()
        {
            setup(1,
            {
                end_immediately: true,
                client_function: is_transport('primus') || is_transport('node_http2') ? client_function : undefined
            });

            it('should fail to read tokens',
               expect_error(is_transport('primus') ? 'tokens missing' :
                            is_transport('node_http2') ? "JWS signature is not a form of 'Head.Payload.SigValue'." :
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

        describe('long token (requires NODE_OPTIONS=--max-http-header-size=32768)', function ()
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

            it('should fail to authorize', expect_error(is_transport('primus') || is_transport('node_http2') ? 'token too long' : 'Message is larger than the allowed maximum of ' + config.max_token_length));
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

        function close_on_before(cb)
        {
            on_pre_after(function (err)
            {
                if (err)
                {
                    return cb(err);
                }

                on_before(cb);
            });
        }

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

                clients[0].on('error', function (err)
                {
                    if (!err.message.startsWith('connect ECONNREFUSED'))
                    {
                        expect(err.message).to.be.oneOf([
                            'write EPIPE',
                            'read ECONNRESET',
                            'write ECONNRESET',
                            'Stream closed with error code NGHTTP2_REFUSED_STREAM',
                            'Request failed',
                            'Body already used' // fetch-h2 retries on GOAWAY
                        ]);
                    }
                });

                var s = clients[0].publish('foo');

                if (is_transport('http'))
                {
                    s.on('error', function (err)
                    {
                        expect(err.message).to.equal('socket hang up');
                    });
                }

                s.write('bar');

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
                        close_on_before(done);
                    });
                });
            });

            it('should emit a close event', function (done)
            {
                close(function ()
                {
                    server.on('close', function ()
                    {
                        close_on_before(done);
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
                            close_on_before(done);
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
                        close_on_before(done);
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
                    close_on_before(done);
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
                        close_on_before(done);
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
                        close_on_before(done);
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
                        close_on_before(done);
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
                expect_error('closed', 1, 503, 0, function (done)
                {
                    close_on_before(done);
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
                expect_error('closed', 1, 503, 0, function (done)
                {
                    close_on_before(done);
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
               expect_error('foo', 1, 0));
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
                        async.eachSeries = function (hs, cb, done)
                        {
                            async.eachSeries = orig_eachSeries;
                            var ths = this;
                            process.nextTick(function ()
                            {
                                orig_eachSeries.call(ths, hs, cb, done);
                            });
                        };
                    };
                },
                client_function: client_function,
                skip_ready: true
            });

            it('should callback if already ended',
               expect_error('foo', 1, 0));
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
                    var cid,
                        server_done = 0,
                        client_done = 0;

                    for (var info of connections.values())
                    {
                        if (info.hsdata[0] === 0)
                        {
                            cid = info.connid;
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
                                clients[0].mux.carrier.removeListener('end', end);
                                clients[1].mux.carrier.removeListener('end', end2);
                                done();
                            }, 1000);
                        }
                        else if ((server_done > 1) || (client_done > 1))
                        {
                            done(new Error('called too many times'));
                        }
                    }

                    function disconnect(connid)
                    {
                        if (connid === cid)
                        {
                            server_done += 1;
                            check();
                        }
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

                    priv_key = jsjws.generatePrivateKey(2048, 65537);
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

                    priv_key = jsjws.generatePrivateKey(2048, 65537);

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
                    }, 2000);

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

                it('should warn on destroy if error occurs while checking revision', expect_error('dummy', 0, 0, 0, on_pre_after));
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

                it('should warn on destroy if old revision', expect_error('uri revision has changed: ' + uri, 0, 0));
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

                    server.on('warning', function warn(err)
                    {
                        if ((err.message !== 'carrier stream finished before duplex finished') &&
                            (err.message !== 'carrier stream ended before end message received'))
                        {
                            msg = err.message;
                            this.removeListener('warning', warn);
                        }
                    });

                    server.once('empty', function ()
                    {
                        expect(msg).to.equal('unknown uri on closed connection: ' + uri);
                        done();
                    });

                    clients[0].on('error', function (err)
                    {
                        expect(err.message).to.be.oneOf([
                            'carrier stream finished before duplex finished',
                            'write after end'
                        ]);
                    });

                    server._connections.delete(uri);
                    clients[0].mux.carrier.end();
                });
            });
        }

        function attach_extension(ext, config)
        {
            ext = server.attach_extension(ext, config);

            for (var info of connections.values())
            {
                if (ext.pre_connect)
                {
                    ext.pre_connect.call(server, info);
                }

                if (ext.connect)
                {
                    ext.connect.call(server, info.connid);
                }
            }

            return ext;
        }

        // Only for testing; apps can't normally detach extensions once they're
        // attached to a server (what about already-active connections etc?).
        // In the tests, we (a) close all connections and (b) where server-wide
        // state is modified, we create a new server.
        function detach_extension(ext)
        {
			for (var ev in ext)
			{
				/* istanbul ignore else */
				if (Object.prototype.hasOwnProperty.call(ext, ev))
				{
					server.removeListener(ev, ext[ev]);
				}
			}
        }

        describe('stream hooks', function ()
        {
            setup(1,
            {
                access_control: {
                    publish: {
                        allow: ['foo', 'foo90'],
                        disallow: []
                    },
                    subscribe: {
                        allow: ['foo', 'foo90'],
                        disallow: []
                    }
                }
            });

            it('should be able to throttle streams', function (done)
            {
                var throttle = require('../lib/server_extensions/throttle'),
                    tps = attach_extension(throttle.throttle_publish_streams,
                                           { rate: 10 }),
                    tms = attach_extension(throttle.throttle_message_streams,
                                           { rate: 10 });

                var time_before_publish;

                clients[0].subscribe('foo', function (s, info)
                {
                    expect(info.topic).to.equal('foo');
                    expect(info.single).to.equal(false);

                    read_all(s, function (v)
                    {
                        expect(process.hrtime(time_before_publish)[0]).to.be.at.least(4);
                        expect(v.toString()).to.equal('012345678901234567890');

                        detach_extension(tps);
                        detach_extension(tms);

                        done();
                    });
                }, function (err)
                {
                    if (err) { return done(err); }

                    time_before_publish = process.hrtime();
                    clients[0].publish('foo').end('012345678901234567890');
                });
            });

            it('should be able to time-out publish streams', function (done)
            {
                var timeout = require('../lib/server_extensions/timeout'),
                    tps = attach_extension(timeout.timeout_publish_streams,
                                           { timeout: 3000 });

                var time_before_publish = process.hrtime();

                clients[0].publish('foo', function (err)
                {
                    expect(err.message).to.equal('server error');
                    expect(process.hrtime(time_before_publish)[0]).to.be.at.least(3);
                    detach_extension(tps);
                    done();
                }).write('A');
            });

            it('should be able to time-out message streams', function (done)
            {
                var timeout = require('../lib/server_extensions/timeout'),
                    tms = attach_extension(timeout.timeout_message_streams,
                                           { timeout: 3000 });

                var size = (options.relay ? 16 : 1)*1024*1024;

                clients[0].subscribe('foo90', function (s, info)
                {
                    expect(info.topic).to.equal('foo90');
                    expect(info.single).to.equal(false);
                    setTimeout(function ()
                    {
                        var client_errored = false,
                            s_errored = false;

                        clients[0].on('error', function (err, obj)
                        {
                            expect(err.message).to.equal('peer error');
                            expect(obj).to.equal(s);
                            client_errored = true;
                        });

                        s.on('error', function (err)
                        {
                            expect(err.message).to.equal('peer error');
                            s_errored = true;
                        });

                        read_all(s, function (v)
                        {
                            expect(client_errored).to.equal(true);
                            expect(s_errored).to.equal(true);
                            if (is_transport('in-mem-pg'))
                            {
                                expect(v.length).to.equal(size);
                            }
                            else
                            {
                                expect(v.length).to.be.below(size);
                            }
                            detach_extension(tms);
                            done();
                        });
                    }, 3000);
                }, function (err)
                {
                    if (err) { return done(err); }
                    clients[0].publish('foo90', function (err)
                    {
                        if (err) { return done(err); }
                    }).end(Buffer.alloc(size));
                });
            });

            it('should be able to limit data published per message', function (done)
            {
                var cid,
                    mqserver,
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
                    server.once('connect', function (connid)
                    {
                        cid = connid;
                        mqserver = connections.get(connid).mqserver;
                        register();
                    });
                }
                else
                {
                    cid = connections.values().next().value.connid;
                    mqserver = connections.values().next().value.mqserver;
                    register();
                }

                server.once('disconnect', function (connid)
                {
                    expect(connid).to.equal(cid);
                    server_done = true;
                    if (client_done)
                    {
                        done();
                    }
                });

                if (is_transport('tcp') || 
                    is_transport('primus') ||
                    options.relay)
                {
                    clients[0].on('error', function (err)
                    {
                        expect(err.message).to.be.oneOf(
                            ['write EPIPE',
                             'read ECONNRESET',
                             'write ECONNRESET',
                             'write ECONNABORTED']);
                    });
                }

                if (is_transport('node_http2-duplex'))
                {
                    clients[0].on('error', function (err)
                    {
                        if (err.message !== 'Stream prematurely closed')
                        {
                            expect(err.response.status).to.equal(404);
                        }
                    });
                }

                if (is_transport('in-mem-pg'))
                {
                    clients[0].on('error', function (err)
                    {
                        expect(err.message).to.equal('write after end');
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
                }).on('error', function (err, unused_data, unused_duplex)
                {
                    if (err.response && is_transport('node_http2-duplex'))
                    {
                        expect(err.response.status).to.equal(404);
                    }
                    else
                    {
                        expect(err.message).to.be.oneOf([
                            'carrier stream finished before duplex finished',
                            'carrier stream ended before end message received',
                            'read ECONNRESET',
                            'write ECONNABORTED',
                            'write ECONNRESET',
                            'write EPIPE',
                            'Cannot call write after a stream was destroyed',
                            'Stream prematurely closed',
                            'write after end'
                        ]);
                    }
                    var c = connections.values().next().value;
                    if (c)
                    {
                        c.destroy();
                    }
                }).end(Buffer.alloc(128 * 1024));
            });

            if (!options.relay)
            {
            var limit_conn = function (close_conn)
            {
            describe('limit_conn (close_conn=' + close_conn + ')', function()
            {
                it('should be able to limit total data published per connection', function (done)
                {
                    var got_message = false,
                        got_error = false,
                        client_done = false,
                        server_done = false,
                        limit = require('../lib/server_extensions/limit_conn'),
                        lcpd = attach_extension(limit.limit_conn_published_data,
                                                { max_conn_published_data_length: 17000,
                                                  close_conn: close_conn });

                    function check()
                    {
                        if (got_error &&
                            (!close_conn || (client_done && server_done)))
                        {
                            detach_extension(lcpd);
                            done();
                        }
                    }

                    clients[0].on('error', function (err)
                    {
                        expect(err.message).to.be.oneOf([
                            'write after end',
                            'read ECONNRESET',
                            'Stream prematurely closed'
                        ]);
                    });

                    if (close_conn)
                    {
                        clients[0].mux.on('end', function ()
                        {
                            client_done = true;
                            check();
                        });

                        server.once('disconnect', function ()
                        {
                            server_done = true;
                            check();
                        });
                    }

                    clients[0].subscribe('foo', function (s, info)
                    {
                        expect(got_message).to.equal(false);
                        got_message = true;

                        expect(info.topic).to.equal('foo');

                        read_all(s, function (v)
                        {
                            expect(v.length).to.equal(17000);
                            clients[0].publish('foo', function (err)
                            {
                                expect(err.message).to.be.oneOf([
                                    'server error',
                                    'write after end',
                                    'carrier stream ended before end message received',
                                    'carrier stream finished before duplex finished',
                                    'read ECONNRESET'
                                ]);
                                got_error = true;
                                check();
                            }).end('A');
                        });
                    }, function (err)
                    {
                        if (err) { return done(err); }
                        clients[0].publish('foo', function (err)
                        {
                            if (err) { done(err); }
                        }).end(Buffer.alloc(17000));
                    });
                });

                it('should be able to limit total number of messages published per connection', function (done)
                {
                    var got_message = false,
                        got_error = false,
                        client_done = false,
                        server_done = false,
                        limit = require('../lib/server_extensions/limit_conn'),
                        lcpm = attach_extension(limit.limit_conn_published_messages,
                                                { max_conn_published_messages: 1,
                                                  close_conn: close_conn });

                    function check()
                    {
                        if (got_error &&
                            (!close_conn || (client_done && server_done)))
                        {
                            detach_extension(lcpm);
                            done();
                        }
                    }

                    clients[0].on('error', function (err)
                    {
                        expect(err.message).to.be.oneOf([
                            'carrier stream finished before duplex finished',
                            'write EPIPE',
                            'write after end',
                            'write ECONNABORTED',
                            'read ECONNRESET',
                            'Cannot call write after a stream was destroyed',
                            'Stream prematurely closed'
                        ]);
                    });

                    if (close_conn)
                    {
                        clients[0].mux.on('end', function ()
                        {
                            client_done = true;
                            check();
                        });

                        server.once('disconnect', function ()
                        {
                            server_done = true;
                            check();
                        });
                    }

                    clients[0].subscribe('foo', function (s, info)
                    {
                        expect(got_message).to.equal(false);
                        got_message = true;

                        expect(info.topic).to.equal('foo');

                        read_all(s, function (v)
                        {
                            expect(v.length).to.equal(1);
                            clients[0].publish('foo', function (err)
                            {
                                expect(err.message).to.be.oneOf([
                                    'server error',
                                    'carrier stream finished before duplex finished'
                                ]);
                                got_error = true;
                                check();
                            }).end('B');
                        });
                    }, function (err)
                    {
                        if (err) { return done(err); }
                        clients[0].publish('foo', function (err)
                        {
                            if (err) { done(err); }
                        }).end('A');
                    });
                });
            });
            };
            limit_conn(true);
            limit_conn(false);
            }
        });

        describe('stream hooks (2 connections)', function ()
        {
            setup(2,
            {
                access_control: {
                    publish: {
                        allow: ['*'],
                        disallow: []
                    },
                    subscribe: {
                        allow: ['*'],
                        disallow: []
                    }
                }
            });

            it('should be able to limit total number of subscriptions across all connections', function (done)
            {
                var limit = require('../lib/server_extensions/limit_active'),
                    las = attach_extension(limit.limit_active_subscriptions,
                                           { max_subscriptions: 2 });

                clients[0].subscribe('foo', function ()
                {
                }, function (err)
                {
                    if (err) { return done(err); }
                    function sub()
                    {
                    }
                    clients[0].subscribe('bar', sub, function (err)
                    {
                        if (err) { return done(err); }
                        clients[0].unsubscribe('bar', sub, function ()
                        {
                            if (err) { return done(err); }
                            clients[1].subscribe('test', function ()
                            {
                            }, function (err)
                            {
                                if (err) { return done(err); }
                                clients[1].subscribe('test2', function ()
                                {
                                }, function (err)
                                {
                                    expect(err.message).to.equal('server error');
                                    detach_extension(las);
                                    done();
                                });
                            });
                        });
                    });
                });
            });

            it('should be able to limit total number of publications across all connections', function (done)
            {
                var limit = require('../lib/server_extensions/limit_active'),
                    las = attach_extension(limit.limit_active_publications,
                                           { max_publications: 1 });

                clients[0].subscribe('foo2', function (s, info)
                {
                    expect(info.topic).to.equal('foo2');
                    read_all(s, function (v)
                    {
                        expect(v.toString()).to.equal('foo2');
                        // check that bar message doesn't arrive
                        setTimeout(function ()
                        {
                            detach_extension(las);
                            done();
                        }, 500);
                    });
                }, function (err)
                {
                    if (err) { return done(err); }
                    clients[0].subscribe('foo', function (s, info)
                    {
                        expect(info.topic).to.equal('foo');
                        read_all(s, function (v)
                        {
                            expect(v.toString()).to.equal('bar');
                            clients[0].publish('foo2', function (err)
                            {
                                if (err) { done(err); }
                            }).end('foo2');
                        });
                    }, function (err)
                    {
                        if (err) { return done(err); }

                        var s = clients[0].publish('foo', function (err)
                        {
                            if (err) { done(err); }
                        });

                        s.write('bar');

                        // give time for publish above to connect
                        setTimeout(function ()
                        {
                            clients[1].publish('bar', function (err)
                            {
                                expect(err.message).to.equal('server error');
                                s.end();
                            }).end('bar2');
                        }, 500);
                    });
                });
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

                client_function: function (c, i, onconnect)
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
                        if (is_transport('node_http2-duplex'))
                        {
                            expect(server.warnings).to.include('unsupported version: 2');
                        }
                        else
                        {
                            expect(server.last_warning.message).to.equal('unsupported version: 2');
                        }

                        if (!(is_transport('primus') || is_transport('tls') || is_transport('node_http2')) ||
                            ((clients[0].last_error.message !== 'carrier stream ended before end message received') &&
                             (clients[0].last_error.message !== 'carrier stream finished before duplex finished') &&
                             (clients[0].last_error.message !== 'read ECONNRESET')))
                        {
                            expect(clients[0].last_error.message).to.equal('data.version should be equal to one of the allowed values');
                        }
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
                    client.version_buffer = Buffer.alloc(2);
                },

                client_function: function (c, i, onconnect)
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
                        expect(clients[0].last_error.message).to.be.oneOf([
                            'Unexpected end of input',
                            'Unexpected end of JSON input'
                        ]);

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

        describe('subscriptions in token', function ()
        {
            setup(2,
            {
                access_control: {
                    publish: {
                        allow: ['foo'],
                        disallow: []
                    },
                    subscribe: {
                        allow: [],
                        disallow: ['foo']
                    }
                },

                separate_tokens: true,

                subscribe: {
                    foo: false
                }
            });

            it('should override access control', function (done)
            {
                clients[1].subscribe('foo', function (s, info)
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
                    clients[1].publish('foo', function (err)
                    {
                        if (err) { return done(err); }
                    }).end('bar');
                });
            });
        });

        describe('existing messages', function ()
        {
            var topic = crypto.randomBytes(64).toString('hex'),
                subscribe = {};
            subscribe[topic] = true;

            setup(2,
            {
                access_control: [{
                    publish: {
                        allow: [topic],
                        disallow: []
                    },
                    subscribe: {
                        allow: [topic],
                        disallow: []
                    }
                }, {
                    publish: {
                        allow: [],
                        disallow: []
                    },
                    subscribe: {
                        allow: [],
                        disallow: []
                    }
                }],

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

        describe("subscriptions in token shouldn't be subject to access control", function ()
        {
            setup(2,
            {
                access_control: {
                    publish: {
                        allow: ['foo'],
                        disallow: []
                    },
                    subscribe: {
                        allow: [],
                        disallow: ['foo']
                    }
                },

                separate_tokens: true,

                subscribe: {
                    foo: false
                }
            });

            it('should override access control', function (done)
            {
                clients[1].subscribe('foo', function (s, info)
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
                    clients[1].publish('foo', function (err)
                    {
                        if (err) { return done(err); }
                    }).end('bar');
                });
            });
        });

        describe('max topic length in subscriptions (client-enforced)', function ()
        {
            setup(2,
            {
                access_control: {
                    publish: {
                        allow: ['foo'],
                        disallow: []
                    },
                    subscribe: {
                        allow: [],
                        disallow: ['foo']
                    }
                },


                subscribe: {
                    foo: false
                },

                max_topic_length: 2,
                separate_tokens: true,
                skip_ready: true,
                client_function: function (c, i, onconnect)
                {
                    if (i === 0)
                    {
                        c.on('ready', function ()
                        {
                            this.ready = true;
                            onconnect();
                        });
                    }
                    else
                    {
                        c.on('error', function (err)
                        {
                            this.last_error = err;
                            onconnect();
                        });
                    }
                }
            });

            it('should error', function (done)
            {
                function check_error(err)
                {
                    expect(err.message).to.equal('data.subscriptions[0] should NOT have additional properties');
                    done();
                }

                function check_error2()
                {
                    if (clients[1].last_error)
                    {
                        return check_error(clients[1].last_error);
                    }

                    clients[1].on('error', check_error);
                }

                // make sure clients[0] doesn't connect later

                if (clients[0].ready)
                {
                    return check_error2();
                }

                clients[0].on('ready', check_error2);
            });
        });

        describe('max words in subscriptions (client-enforced)', function ()
        {
            setup(2,
            {
                access_control: {
                    publish: {
                        allow: ['foo'],
                        disallow: []
                    },
                    subscribe: {
                        allow: [],
                        disallow: ['foo']
                    }
                },

                subscribe: {
                    [new Array(51).join('.')]: false
                },

                max_words: 50,
                separate_tokens: true,
                skip_ready: true,
                client_function: function (c, i, onconnect)
                {
                    if (i === 0)
                    {
                        c.on('ready', function ()
                        {
                            this.ready = true;
                            onconnect();
                        });
                    }
                    else
                    {
                        c.on('error', function (err)
                        {
                            this.last_error = err;
                            onconnect();
                        });
                    }
                }
            });

            it('should error', function (done)
            {
                function check_error(err)
                {
                    expect(err.message).to.equal('data.subscriptions[0] should NOT have additional properties');
                    done();
                }

                function check_error2()
                {
                    if (clients[1].last_error)
                    {
                        return check_error(clients[1].last_error);
                    }

                    clients[1].on('error', check_error);
                }

                // make sure clients[0] doesn't connect later

                if (clients[0].ready)
                {
                    return check_error2();
                }

                clients[0].on('ready', check_error2);
            });
        });

        describe('max words in subscriptions (server-enforced)', function ()
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

                subscribe: {
                    [new Array(101).join('.')]: false
                },

                separate_tokens: true,
                skip_ready: true,
                client_function: get_info().client_function
            });

            it('should reject subscribe topics',
               expect_error('data.subscribe should NOT have additional properties', false, 401, 1, function (done)
               {
                   // make sure clients[0] doesn't connect later

                   if (clients[0].ready)
                   {
                       return done();
                   }

                   clients[0].on('ready', done);
               }));
        });

        describe('max words when subscribing', function ()
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

            it('should block too many words', function (done)
            {
                clients[0].subscribe('foo', function () {},
                function (err)
                {
                    if (err) { return done(err); }
                    clients[0].subscribe(new Array(101).join('.'), function () {},
                    function (err)
                    {
                        expect(err.message).to.be.oneOf(
                        [
                            'server error',
                            'data.topics[0] should match pattern "^(?=[^\\u002e]*(\\u002e[^\\u002e]*){0,99}$)(?=([^\\u0023]|((?<!(^|\\u002e))\\u0023)|\\u0023(?!($|\\u002e)))*(((?<=(^|\\u002e))\\u0023(?=($|\\u002e)))([^\\u0023]|((?<!(^|\\u002e))\\u0023)|\\u0023(?!($|\\u002e)))*){0,3}$)"'
                        ]);
                        expect(get_info().server.last_warning.message).to.equal(options.relay ? 'data.topics[0] should match pattern "^(?=[^\\u002e]*(\\u002e[^\\u002e]*){0,99}$)(?=([^\\u0023]|((?<!(^|\\u002e))\\u0023)|\\u0023(?!($|\\u002e)))*(((?<=(^|\\u002e))\\u0023(?=($|\\u002e)))([^\\u0023]|((?<!(^|\\u002e))\\u0023)|\\u0023(?!($|\\u002e)))*){0,3}$)"' : 'subscribe too many words');
                        done();
                    });
                });
            });
        });

        describe('max wildcard somes in subscriptions (client-enforced)', function ()
        {
            setup(2,
            {
                access_control: {
                    publish: {
                        allow: ['foo'],
                        disallow: []
                    },
                    subscribe: {
                        allow: [],
                        disallow: ['foo']
                    }
                },

                subscribe: {
                    [new Array(3).fill('#').join('.')]: false
                },

                max_wildcard_somes: 2,
                separate_tokens: true,
                skip_ready: true,
                client_function: function (c, i, onconnect)
                {
                    if (i === 0)
                    {
                        c.on('ready', function ()
                        {
                            this.ready = true;
                            onconnect();
                        });
                    }
                    else
                    {
                        c.on('error', function (err)
                        {
                            this.last_error = err;
                            onconnect();
                        });
                    }
                }
            });

            it('should error', function (done)
            {
                function check_error(err)
                {
                    expect(err.message).to.equal('data.subscriptions[0] should NOT have additional properties');
                    done();
                }

                function check_error2()
                {
                    if (clients[1].last_error)
                    {
                        return check_error(clients[1].last_error);
                    }

                    clients[1].on('error', check_error);
                }

                // make sure clients[0] doesn't connect later

                if (clients[0].ready)
                {
                    return check_error2();
                }

                clients[0].on('ready', check_error2);
            });
        });

        describe('max wildcard somes in subscriptions (server-enforced)', function ()
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

                subscribe: {
                    [new Array(4).fill('#').join('.')]: false
                },

                separate_tokens: true,
                skip_ready: true,
                client_function: get_info().client_function
            });

            it('should reject subscribe topics',
               expect_error('data.subscribe should NOT have additional properties', false, 401, 1, function (done)
               {
                   // make sure clients[0] doesn't connect later

                   if (clients[0].ready)
                   {
                       return done();
                   }

                   clients[0].on('ready', done);
               }));
        });

        describe('max wildcard somes when subscribing', function ()
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

            it('should block too many wildcard somes', function (done)
            {
                clients[0].subscribe('foo', function () {},
                function (err)
                {
                    if (err) { return done(err); }
                    clients[0].subscribe(new Array(4).fill('#').join('.'), function () {},
                    function (err)
                    {
                        expect(err.message).to.be.oneOf(
                        [
                            'server error',
                            'data.topics[0] should match pattern "^(?=[^\\u002e]*(\\u002e[^\\u002e]*){0,99}$)(?=([^\\u0023]|((?<!(^|\\u002e))\\u0023)|\\u0023(?!($|\\u002e)))*(((?<=(^|\\u002e))\\u0023(?=($|\\u002e)))([^\\u0023]|((?<!(^|\\u002e))\\u0023)|\\u0023(?!($|\\u002e)))*){0,3}$)"'
                        ]);
                        expect(get_info().server.last_warning.message).to.equal(options.relay ? 'data.topics[0] should match pattern "^(?=[^\\u002e]*(\\u002e[^\\u002e]*){0,99}$)(?=([^\\u0023]|((?<!(^|\\u002e))\\u0023)|\\u0023(?!($|\\u002e)))*(((?<=(^|\\u002e))\\u0023(?=($|\\u002e)))([^\\u0023]|((?<!(^|\\u002e))\\u0023)|\\u0023(?!($|\\u002e)))*){0,3}$)"' : 'subscribe too many wildcard somes');
                        done();
                    });
                });
            });
        });

        describe('should be able to error and end', function ()
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

            it('should get peer error', function (done)
            {
                function regmsg(mqserver)
                {
                    mqserver.on('message', function (stream, info, multiplex, done)
                    {
                        stream.pipe(multiplex());
                        done(new Error('dummy'));
                    });
                }

                var s_obj;

                clients[0].on('error', function (err, obj)
                {
                    expect(err.message).to.equal('peer error');
                    s_obj = obj;
                });

                clients[0].subscribe('foo', function (s, unused_info)
                {
                    s.on('error', function (err)
                    {
                        expect(err.message).to.equal('peer error');
                        expect(s).to.equal(s_obj);
                        done();
                    });
                }, function (err)
                {
                    if (err) { return done(err); }

                    for (var info of connections.values())
                    {
                        regmsg(info.mqserver);
                    }

                    clients[0].publish('foo').end('bar');
                });
            });
        });

        describe('authorization start and end events', function ()
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
                    server.count_authz_start = 0;
                    server.count_authz_end = 0;

                    server.on('authz_start', function ()
                    {
                        this.count_authz_start += 1;
                    });

                    server.on('authz_end', function ()
                    {
                        this.count_authz_end += 1;
                    });
                }
            });

            it('should emit authz_start and authz_end', function (done)
            {
                clients[0].publish('foo', function (err)
                {
                    if (err) { return done(err); }
                    expect(server.count_authz_start).to.equal(options.relay ? 2 :1);
                    expect(server.count_authz_end).to.equal(options.relay ? 2 :1);
                    server.removeAllListeners('authz_start');
                    server.removeAllListeners('authz_end');
                    delete server.count_authz_start;
                    delete server.count_authz_end;
                    done();
                }).end('bar');
            });
        });

        describe('cancel authorization', function ()
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
                    server.on('authz_start', function (cancel)
                    {
                        cancel();
                    });

                    server.on('authz_end', function (err)
                    {
                        expect(err.message).to.equal('cancelled');
                    });
                },

                client_function: client_function,
                skip_ready: true
            });

            it('should cancel authorization',
               expect_error('cancelled', true, 401, 0, function (done)
               {
                   server.removeAllListeners('authz_start');
                   server.removeAllListeners('authz_end');
                   done();
               }));
        });

        if (options.relay)
        {
            describe('cancel publish and subscribe authorization', function ()
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

                it('should cancel authorization', function (done)
                {
                    var closed = 0;

                    server.on('authz_start', function (cancel, onclose)
                    {
                        onclose(function ()
                        {
                            closed += 1;
                        });
                        cancel(new Error('dummy'));
                    });

                    server.on('authz_end', function (err)
                    {
                        expect(err.message).to.equal('dummy');
                    });

                    clients[0].subscribe('foo', function ()
                    {
                        done(new Error('should not be called'));
                    }, function (err)
                    {
                        expect(err.message).to.equal('dummy');
                        clients[0].publish('foo', function (err)
                        {
                            setTimeout(function ()
                            {
                                expect(err.message).to.equal('dummy');
                                expect(closed).to.equal(2);
                                server.removeAllListeners('authz_start');
                                server.removeAllListeners('authz_end');
                                done();
                            }, 500);
                        }).end('bar');
                    });
                });

                it('should cancel authorization (before onclose)', function (done)
                {
                    var closed = 0;

                    server.on('authz_start', function (cancel, onclose)
                    {
                        cancel(new Error('dummy'));
                        setTimeout(function ()
                        {
                            onclose(function ()
                            {
                                closed += 1;
                            });
                        }, 500);
                    });

                    server.on('authz_end', function (err)
                    {
                        expect(err.message).to.equal('dummy');
                    });

                    clients[0].subscribe('foo', function ()
                    {
                        done(new Error('should not be called'));
                    }, function (err)
                    {
                        expect(err.message).to.equal('dummy');
                        clients[0].publish('foo', function (err)
                        {
                            setTimeout(function ()
                            {
                                expect(err.message).to.equal('dummy');
                                expect(closed).to.equal(2);
                                server.removeAllListeners('authz_start');
                                server.removeAllListeners('authz_end');
                                done();
                            }, 2000);
                        }).end('bar');
                    });
                });
            });
        }

        describe('track connections', function ()
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

                before_connect_function: function ()
                {
                    server.conn_count = 0;

                    server.on('authz_start', function (cancel, onclose)
                    {
                        server.conn_count += 1;
                        onclose(function ()
                        {
                            server.conn_count -= 1;
                        });
                    });
                }
            });

            it('should be able to count active connections', function (done)
            {
                function wait(n, cb)
                {
                    if (server.conn_count === n)
                    {
                        return cb();
                    }

                    setTimeout(function ()
                    {
                        wait(n, cb);
                    }, 100);
                }

                wait(2, function ()
                {
                    clients[0].on('error', function (err)
                    {
                        expect(err.message).to.be.oneOf([
                            'carrier stream finished before duplex finished',
                            'write after end'
                        ]);
                    });
                    clients[0].mux.carrier.end();
                    wait(1, function ()
                    {
                        clients[1].on('error', function (err)
                        {
                            expect(err.message).to.equal('carrier stream finished before duplex finished');
                        });
                        clients[1].mux.carrier.end();
                        wait(0, function ()
                        {
                            server.removeAllListeners('authz_start');
                            delete server.conn_count;
                            done();
                        });
                    });
                });
            });
        });

        describe('limit connections', function ()
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

                before_connect_function: function ()
                {
                    var limit = require('../lib/server_extensions/limit_active');
                    this.centro_test_lac = attach_extension(
                            limit.limit_active_connections,
                            { max_connections: 1 });
                },

                client_function: client_function,
                skip_ready: 1,
                series: true
            });

            it('should be able to limit number of active connections',
               expect_error('connection limit 1 exceeded', is_transport('tcp') ? 1 : true, 401, 1, function (done)
               {
                   detach_extension(this.centro_test_lac);
                   done();
               }));
        });

        if (!options.anon)
        {
            describe('unsupported algorithm', function ()
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

                    alg: 'RS256',

                    client_function: client_function,
                    skip_ready: true
                });

                it('should not accept token',
                   expect_error('algorithm not allowed: RS256'));
            });
        }

        if (!options.relay)
        {
            describe('full event', function ()
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

                    max_open: 1001
                });

                it('should emit full event, warning and error', function (done)
                {
                    var client_full = false,
                        server_full = 0,
                        server_warning = false;

                    function check()
                    {
                        if (client_full &&
                            (server_full == 2) && // one when reaches 1000
                                                  // another for msg 1001
                            server_warning)
                        {
                            done();
                        }
                    }

                    function reg(mqserver)
                    {
                        mqserver.mux.on('full', function ()
                        {
                            server_full += 1;
                            check();
                        });
                    }

                    for (var info of connections.values())
                    {
                        reg(info.mqserver);
                    }

                    server.once('warning', function (err, mqserver)
                    {
                        expect(err.message).to.equal('full');
                        expect(get_connid_from_mqserver(mqserver)).not.to.equal(undefined);
                        server_warning = true;
                        check();
                    });

                    clients[0].on('error', function (err)
                    {
                        expect(err.message).to.equal('write after end');
                    });

                    clients[0].on('warning', function (err)
                    {
                        expect(err.message).to.be.oneOf([
                            'carrier stream ended before end message received',
                            'carrier stream finished before duplex finished'
                        ]);
                    });

                    // give chance for initial handshake duplex to close
                    setTimeout(function ()
                    {
                        function expect_err(err)
                        {
                            expect(err.message).to.be.oneOf([
                                'carrier stream finished before duplex finished',
                                'carrier stream ended before end message received',
                                'write after end'
                            ]);
                        }

                        for (var i = 0; i < 1001; i += 1)
                        {
                            clients[0].publish('foo', expect_err).write('bar');
                        }

                        expect(function ()
                        {
                            clients[0].publish('foo', function ()
                            {
                                done(new Error('should not be called'));
                            }).write('bar');
                        }).to.throw('full');

                        client_full = true;
                        check();
                    }, 500);
                });
            });
        }

        describe('close on error', function ()
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

            it('should close connection if it errors', function (done)
            {
                var ccoe = require('../lib/server_extensions/close_conn_on_error'),
                    ext = attach_extension(ccoe.close_conn_on_error);

                if (is_transport('node_http2-duplex'))
                {
                    clients[0].on('error', function (err)
                    {
                        if (err.message !== 'Stream prematurely closed')
                        {
                            expect(err.response.status).to.equal(404);
                        }
                    });
                }
                else
                {
                    clients[0].on('error', function (err)
                    {
                        expect(err.message).to.be.oneOf([
                            'read ECONNRESET',
                            'write ECONNRESET',
                            'write EPIPE',
                            'write ECONNABORTED',
                            'carrier stream finished before duplex finished'
                        ]);
                    });
                }

                server.once('disconnect', function ()
                {
                    detach_extension(ext);
                    on_pre_after(done);
                });

                for (var info of connections.values())
                {
                    info.mqserver.mux.emit('error', new Error('foo'));
                }
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
            var on_delay;

            run.call(this, Object.assign(
            {
                only: function (get_info)
                {
                    get_info().setup(1,
                    {
                        access_control: {
                            publish: {
                                allow: ['foo.*'],
                                disallow: []
                            },
                            subscribe: {
                                allow: ['foo.*'],
                                disallow: []
                            }
                        }
                    });

                    it('should be able to filter handlers', function (done)
                    {
                        if ((is_transport('tcp') && !config.noDelay) || config.fsq)
                        {
                            return this.skip();
                        }

                        // test filter on handler without .mqlobber_server
                        get_info().server.fsq.subscribe(get_info().connections.values().next().value.prefixes[0] + 'foo.foo', function ()
                        {
                        });

                        var ack_bar,
                            got_foo = false,
                            count = 0;

                        // two filters, first is mqlobber-access-control
                        expect(get_info().server.fsq.filters.length).to.equal(2);

                        get_info().server.fsq.filters.unshift(function (info, handlers, cb)
                        {
                            if (!info.existing)
                            {
                                count += 1;
                            }
                            cb(null, true, handlers);
                        });

                        var done1 = false, done2 = false;

                        function check()
                        {
                            if (done1 && done2)
                            {
                                done();
                            }
                        }

                        get_info().clients[0].subscribe('foo.*', function (s, info, ack)
                        {
                            if (info.topic === 'foo.bar')
                            {
                                expect(count).to.equal(1);

                                on_delay = function (info)
                                {
                                    var prefix = get_info().connections.values().next().value.prefixes[0];
                                    expect(info.topic).to.be.oneOf([
                                        prefix + 'foo.foo',
                                        prefix + 'foo.bar' // we don't read immediately so qlobber-fsq will try again (but find it locked)
                                    ]);

                                    expect(got_foo).to.equal(false);

                                    // 1 for each message but then foo.foo
                                    // should be tried again at least once
                                    if (count <= 2)
                                    {
                                        return;
                                    }

                                    on_delay = null;

                                    ack_bar = ack;
                                    read_all(s, function ()
                                    {
                                        done1 = true;
                                        check();
                                    });
                                };

                                return this.publish('foo.foo', function (err)
                                {
                                    if (err) { return done(err); }
                                }).end('hello');
                            }

                            expect(info.topic).to.equal('foo.foo');
                            got_foo = true;

                            read_all(s, function (v)
                            {
                                expect(v.toString()).to.equal('hello');
                                ack_bar();
                                done2 = true;
                                check();
                            });
                        }, function (err)
                        {
                            if (err) { return done(err); }
                            get_info().clients[0].publish('foo.bar',
                            {
                                single: true
                            }, function (err)
                            {
                                if (err) { return done(err); }
                            }).end(Buffer.alloc(8 * 1024 * 1024));
                        });
                    });
                },

                handler_concurrency: 2,

                before_server_ready: function (get_info)
                {
                    var filter = require('../lib/server_extensions/filter');
                    get_info().attach_extension(
                        filter.delay_message_until_all_streams_under_hwm,
                        {
                            on_delay: function (info)
                            {
                                if (on_delay)
                                {
                                    on_delay(info);
                                }
                            }
                        });
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
                        var message0_called = false,
                            message1_called = false,
                            laggard0_called = false,
                            laggard1_called = false,
                            buf = Buffer.alloc(100 * 1024),
                            mqservers = [],
                            prefixes = [];

                        buf.fill('a');

                        function check(msg_stream, info, num_handlers)
                        {
                            expect(info.topic).to.equal(prefixes[0][0] + 'foo');
                            info.count = info.count || 0;
                            info.count += 1;

                            if (info.count === num_handlers)
                            {
                                msg_stream.centro_server_extension_filter_fastest_writable.once('peer_added', function ()
                                {
                                    // make fastest_writable enter waiting state
                                    // we need to do this after fw has added
                                    // both peers but not in nextTick because
                                    // then the first data will have been
                                    // written
                                    msg_stream.centro_server_extension_filter_fastest_writable.write(buf);
                                });
                            }
                        }

                        function message0(msg_stream, info, multiplex, cb, next)
                        {
                            expect(message0_called).to.equal(false);
                            message0_called = true;
                            next(msg_stream, info, function ()
                            {
                                var duplex = multiplex.apply(this, arguments);
                                duplex.on('laggard', function ()
                                {
                                    laggard0_called = true;
                                });
                                check(msg_stream, info, multiplex.num_handlers);
                                return duplex;
                            }, cb);
                        }
                        
                        function message1(msg_stream, info, multiplex, cb, next)
                        {
                            expect(message1_called).to.equal(false);
                            message1_called = true;
                            next(msg_stream, info, function ()
                            {
                                var null_stream = new NullStream();
                                null_stream.on('laggard', function ()
                                {
                                    laggard1_called = true;
                                });
                                check(msg_stream, info, multiplex.num_handlers);
                                return null_stream;
                            }, cb);
                        }

                        if (options.relay)
                        {
                            var pccount = 0;

                            get_info().server.on('pre_connect', function preconnect(info)
                            {
                                mqservers[pccount] = info.mqserver;
                                prefixes[pccount] = info.prefixes;
                                this.pipeline(info.mqserver, 'message', pccount === 0 ? message0 : message1);
                                pccount += 1;
                                if (pccount === 2)
                                {
                                    this.removeListener('pre_connect', preconnect);
                                }
                            });
                        }
                        else
                        {
                            for (var info of get_info().connections.values())
                            {
                                mqservers[info.hsdata[0]] = info.mqserver;
                                prefixes[info.hsdata[0]] = info.prefixes;
                            }

                            pipeline(mqservers[0], 'message', message0);
                            pipeline(mqservers[1], 'message', message1);
                        }

                        var filter = require('../lib/server_extensions/filter');
                        get_info().attach_extension(
                            filter.fastest_writable,
                            {
                                emit_laggard: true,
                                on_fw: function (fw, mqserver, s, info)
                                {
                                    expect(fw).to.be.an.instanceOf(require('fastest-writable').FastestWritable);
                                    expect(mqserver).to.be.oneOf(mqservers);
                                    expect(info.topic).to.equal(prefixes[0][0] + 'foo');
                                }
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
                            get_info().clients[1].subscribe('#', function (unused_s, unused_info)
                            {
                                done(new Error('should not be called'));
                            }, function (err)
                            {
                                if (err) { return done(err); }
                                get_info().clients[0].publish('foo').end('bar');
                            });
                        });
                    });
                }
            }, config));
        });

        describe('initial message data (default behaviour)', function ()
        {
            run.call(this, Object.assign(
            {
                only: function (get_info)
                {
                    get_info().setup(1,
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

                    it('should read initial data from message by default', function (done)
                    {
                        let message_called = false,
                            buf = Buffer.alloc(100 * 1024);

                        function message(msg_stream, info, multiplex, cb, next)
                        {
                            expect(message_called).to.equal(false);
                            message_called = true;
                            next(msg_stream, info, function ()
                            {
                                let ns = new NullStream();
                                ns.write(buf);
                                expect(ns._writableState.length).to.equal(100 * 1024);
                                setTimeout(function ()
                                {
                                    expect(ns._writableState.length).to.be.above(100 * 1024);
                                    cb(null, done);
                                }, 2000);
                                return ns;
                            }, cb);
                        }

                        if (options.relay)
                        {
                            get_info().server.once('pre_connect', function (info)
                            {
                                this.pipeline(info.mqserver, 'message', message);
                            });
                        }
                        else
                        {
                            for (let info of get_info().connections.values())
                            {
                                pipeline(info.mqserver, 'message', message);
                            }
                        }

                        get_info().clients[0].subscribe('foo', function ()
                        {
                            done(new Error('should not be called'));
                        }, function (err)
                        {
                            if (err) { return done(err); }
                            get_info().clients[0].publish('foo').end('bar');
                        });
                    });
                }
            }, config));
        });

        describe('initial message data (dummy data event)', function ()
        {
            run.call(this, Object.assign(
            {
                only: function (get_info)
                {
                    get_info().setup(1,
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

                    it('should not read initial data from message', function (done)
                    {
                        let message_called = false,
                            buf = Buffer.alloc(100 * 1024);

                        function message(msg_stream, info, multiplex, cb, next)
                        {
                            expect(message_called).to.equal(false);
                            message_called = true;
                            next(msg_stream, info, function ()
                            {
                                let ns = new NullStream();
                                ns.write(buf);
                                expect(ns._writableState.length).to.equal(100 * 1024);
                                setTimeout(function ()
                                {
                                    expect(ns._writableState.length).to.equal(100 * 1024);
                                    cb(null, done);
                                }, 2000);
                                return ns;
                            }, cb);
                        }

                        if (options.relay)
                        {
                            get_info().server.once('pre_connect', function (info)
                            {
                                this.pipeline(info.mqserver, 'message', message);
                            });
                        }
                        else
                        {
                            for (let info of get_info().connections.values())
                            {
                                pipeline(info.mqserver, 'message', message);
                            }
                        }

                        var filter = require('../lib/server_extensions/filter');
                        get_info().attach_extension(filter.dummy_data_event);

                        get_info().clients[0].subscribe('foo', function ()
                        {
                            done(new Error('should not be called'));
                        }, function (err)
                        {
                            if (err) { return done(err); }
                            get_info().clients[0].publish('foo').end('bar');
                        });
                    });
                }
            }, config));
        });

        describe('max topic length in subscriptions (server-enforced)', function ()
        {
            run.call(this, Object.assign({}, config,
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
                                allow: ['foo'],
                                disallow: []
                            }
                        },

                        subscribe: {
                            foobar: false
                        },

                        separate_tokens: true,
                        skip_ready: true,
                        client_function: get_info().client_function
                    });

                    it('should reject subscribe topics',
                       get_info().expect_error('data.subscribe should NOT have additional properties', false, 401, 1, function (done)
                       {
                           // make sure clients[0] doesn't connect later

                           if (get_info().clients[0].ready)
                           {
                               return done();
                           }

                           get_info().clients[0].on('ready', done);
                       }));
                },

                max_topic_length: 3
            }));
        });

        describe('max topic length when subscribing', function ()
        {
            run.call(this, Object.assign({}, config,
            {
                only: function (get_info)
                {
                    get_info().setup(1,
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

                    it('should block long topic', function (done)
                    {
                        get_info().clients[0].subscribe('foo', function () {},
                        function (err)
                        {
                            if (err) { return done(err); }
                            get_info().clients[0].subscribe('foobar', function () {},
                            function (err)
                            {
                                expect(err.message).to.be.oneOf(
                                [
                                    'server error',
                                    'data.topics[0] should match pattern "^(?=[^\\u002e]*(\\u002e[^\\u002e]*){0,99}$)(?=([^\\u0023]|((?<!(^|\\u002e))\\u0023)|\\u0023(?!($|\\u002e)))*(((?<=(^|\\u002e))\\u0023(?=($|\\u002e)))([^\\u0023]|((?<!(^|\\u002e))\\u0023)|\\u0023(?!($|\\u002e)))*){0,3}$)(?=.{0,3}$)"'
                                ]);
                                expect(get_info().server.last_warning.message).to.equal(options.relay ? 'data.topics[0] should match pattern "^(?=[^\\u002e]*(\\u002e[^\\u002e]*){0,99}$)(?=([^\\u0023]|((?<!(^|\\u002e))\\u0023)|\\u0023(?!($|\\u002e)))*(((?<=(^|\\u002e))\\u0023(?=($|\\u002e)))([^\\u0023]|((?<!(^|\\u002e))\\u0023)|\\u0023(?!($|\\u002e)))*){0,3}$)(?=.{0,3}$)"' : ('subscribe topic longer than ' + (options.anon ? 3 : 68)));
                                done();
                            });
                        });
                    });
                },

                max_topic_length: 3
            }));
        });

        if (!options.relay)
        {
            describe('max subscriptions', function ()
            {
                run.call(this, Object.assign(
                {
                    only: function (get_info)
                    {
                        get_info().setup(1,
                        {
                            access_control: {
                                publish: {
                                    allow: ['foo'],
                                    disallow: []
                                },
                                subscribe: {
                                    allow: ['foo', 'bar'],
                                    disallow: []
                                }
                            }
                        });

                        it('should limit subscriptions', function (done)
                        {
                            get_info().clients[0].subscribe('foo', function () {},
                            function (err)
                            {
                                if (err) { return done(err); }
                                get_info().clients[0].subscribe('bar', function () {},
                                function (err)
                                {
                                    expect(err.message).to.equal('server error');
                                    expect(get_info().server.last_warning.message).to.equal('subscription limit 1 already reached: ' + get_info().connections.values().next().value.prefixes[0] + 'bar');
                                    done();
                                });
                            });
                        });
                    },

                    max_subscriptions: 1
                }, config));
            });

            describe('max publications', function ()
            {
                run.call(this, Object.assign(
                {
                    only: function (get_info)
                    {
                        get_info().setup(1,
                        {
                            access_control: {
                                publish: {
                                    allow: ['*'],
                                    disallow: []
                                },
                                subscribe: {
                                    allow: ['*'],
                                    disallow: []
                                }
                            }
                        });

                        it('should limit publications', function (done)
                        {
                            get_info().clients[0].subscribe('foo2', function (s, info)
                            {
                                expect(info.topic).to.equal('foo2');
                                read_all(s, function (v)
                                {
                                    expect(v.toString()).to.equal('foo2');
                                    // check that bar message doesn't arrive
                                    setTimeout(done, 500);
                                });
                            }, function (err)
                            {
                                if (err) { return done(err); }
                                get_info().clients[0].subscribe('foo', function (s, info)
                                {
                                    expect(info.topic).to.equal('foo');
                                    read_all(s, function (v)
                                    {
                                        expect(v.toString()).to.equal('bar');
                                        get_info().clients[0].publish('foo2', function (err)
                                        {
                                            if (err) { done(err); }
                                        }).end('foo2');
                                    });
                                }, function (err)
                                {
                                    if (err) { return done(err); }

                                    var s = get_info().clients[0].publish('foo', function (err)
                                    {
                                        if (err) { done(err); }
                                    });

                                    s.write('bar');

                                    get_info().clients[0].publish('bar', function (err)
                                    {
                                        expect(err.message).to.equal('server error');
                                        s.end();
                                    }).end('bar2');
                                });
                            });
                        });
                    }
                }, config, { max_publications: 1 }));
            });
        }

        describe('max publish data', function ()
        {
            run.call(this, Object.assign(
            {
                only: function (get_info)
                {
                    get_info().setup(1,
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

                    it('should limit publish data', function (done)
                    {
                        get_info().clients[0].subscribe('foo', function ()
                        {
                            done(new Error('should not be called'));
                        },
                        function (err)
                        {
                            if (err) { return done(err); }
                            var s = get_info().clients[0].publish('foo', function (err)
                            {
                                expect(err.message).to.equal('server error');
                                var limit_errmsg = 'message data exceeded limit 1000: ' + get_info().connections.values().next().value.prefixes[0] + 'foo';
                                var last_errmsg = get_info().server.last_warning.message;
                                if (options.relay)
                                {
                                    expect(last_errmsg).to.be.oneOf([
                                        limit_errmsg,
                                        'server error'
                                    ]);
                                }
                                else
                                {
                                    expect(last_errmsg).to.equal(limit_errmsg);
                                }

                                done();
                            });
                            s.write(Buffer.alloc(500));
                            s.end(Buffer.alloc(501));
                        });
                    });
                },

                max_publish_data_length: 1000
            }, config));
        });

        describe('transport ready event', function ()
        {
            var cfg = Object.assign(
            {
                only: options.relay ? function (get_info)
                {
                    get_info().setup(1,
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

                    it('maxConnections', function (done)
                    {
                        var ths = this;

                        if (is_transport('http2'))
                        {
                            get_info().clients[0].on('warning', function (err)
                            {
                                expect(err.message).to.be.oneOf([
                                    'Client network socket disconnected before secure TLS connection was established',
                                    'read ECONNRESET'
                                ]);
                            });
                        }

                        get_info().clients[0].subscribe('foo', function ()
                        {
                            done(new Error('should not be called'));
                        }, function (err)
                        {
                            if (err) { return done(err); }
                            if (is_transport('http2'))
                            {
                                cfg.client2_save = cfg.client2;
                                cfg.client2 = cfg.make_client2();
                            }

                            var s = get_info().clients[0].publish('foo'),
                                called = false;

                            function rejected()
                            {
                                if (called) { return; }
                                called = true;

                                get_info().detach_extension(ths.centro_test_ltc);
                                if (is_transport('http2'))
                                {
                                    return get_info().on_pre_after(function (err)
                                    {
                                        cfg.client2 = cfg.client2_save;
                                        delete cfg.client2_save;
                                        done(err);
                                    });
                                }
                                done();
                            }

                            s.on('error', function (err)
                            {
                                expect(err.message).to.be.oneOf([
                                    'socket hang up',
                                    'read ECONNRESET',
                                    'Client network socket disconnected before secure TLS connection was established',
                                    'The pending stream has been canceled (caused by: Client network socket disconnected before secure TLS connection was established)',
                                    'The pending stream has been canceled (caused by: read ECONNRESET)'
                                ]);

                                rejected();
                            });

                            s.on('close', rejected);

                            s.end('bar');
                        });
                    });

                    it('request timeout', function (done)
                    {
                        var ths = this,
                            now = process.hrtime(),
                            s;
                        function on_error(err)
                        {
                            expect(process.hrtime(now)[0]).to.be.at.least(2);
                            expect(err.message).to.equal(is_transport('http2') ? 'server error' : 'socket hang up');
                            get_info().detach_extension(ths.centro_test_thpr);
                            done();
                        }
                        if (is_transport('http2'))
                        {
                            s = get_info().clients[0].publish('foo', on_error);
                        }
                        else
                        {
                            s = get_info().clients[0].publish('foo');
                            s.on('error', on_error);
                        }
                        s.write('a');
                    });
                } : function (get_info)
                {
                    var conn_error;

                    get_info().setup(2,
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

                        client_function: get_info().client_function,
                        skip_ready: 1,
                        series: true,

                        on_connect_error: is_transport('tls') ? function (err)
                        {
                            conn_error = err;
                        } : undefined
                    });

                    it('maxConnections', get_info().expect_error(
                       undefined, 1, undefined, 1, function (done)
                       {
                           if (is_transport('tls'))
                           {
                               expect(conn_error.message).to.be.oneOf([
                                   'socket hang up',
                                   'read ECONNRESET',
                                   'Client network socket disconnected before secure TLS connection was established'
                               ]);
                           }
                           get_info().detach_extension(this.centro_test_ltc); 
                           done();
                       }));
                },

                before_server_ready: function (get_info)
                {
                    var ths = this,
                        limit = require('../lib/server_extensions/limit_transport');

                    this.centro_test_ltc = get_info().attach_extension(
                            limit.limit_transport_connections,
                            { max_transport_connections: 1 });

                    get_info().server.on('transport_ready', function (tconfig, ops)
                    {
                        if (!ops.server)
                        {
                            ths.test_should_skip = !options.relay;
                            get_info().detach_extension(ths.centro_test_ltc); 
                        }
                    });

                    if (options.relay)
                    {
                        var timeout = require('../lib/server_extensions/timeout');

                        this.centro_test_thpr = get_info().attach_extension(
                            timeout.timeout_http_publish_requests,
                            { http_publish_timeout: 2000 });
                    }
                }
            }, config);
            run.call(this, cfg);
        });

        function backoff_event(f, before_server_ready)
        {
            /*jshint validthis: true */
            run.call(this, Object.assign(
            {
                test_timeout: 60000,

                only: function (get_info)
                {
                    get_info().setup(1,
                    {
                        access_control: {
                            publish: {
                                allow: ['foo', 'foo2'],
                                disallow: []
                            },
                            subscribe: {
                                allow: ['foo', 'foo2', 'bar'],
                                disallow: []
                            }
                        },
                        ttl: 10 * 60
                    });

                    function restore()
                    {
                        for (var info of get_info().connections.values())
                        {
                            var carrier = info.mqserver.mux.carrier;

                            carrier._write = carrier.orig_write;
                            carrier._write(carrier.the_chunk, carrier.the_encoding, carrier.the_callback);
                        }
                    }

                    function check(state)
                    {
                        if (state.server_backoff && state.server_warning)
                        {
                            if (!state.no_restore && !state.restore_called)
                            {
                                state.restore_called = true;
                                restore();
                            }

                            if (state.done && !state.done_called)
                            {
                                state.done_called = true;
                                state.done();
                            }
                        }
                    }

                    function reg(mqserver, state)
                    {
                        mqserver.on('backoff', function ()
                        {
                            state.server_backoff = true;
                            check(state);
                        });

                        if (state.maxListeners !== undefined)
                        {
                            mqserver.setMaxListeners(state.maxListeners);
                        }

                        if (state.dummy_publish)
                        {
                            mqserver.on('publish_requested', function (topic, stream, options, cb)
                            {
                                cb();
                            });
                        }

                        mqserver.mux.carrier.orig_write = mqserver.mux.carrier._write;
                        mqserver.mux.carrier._write = function (chunk, encoding, callback)
                        {
                            mqserver.mux.carrier.the_chunk = chunk;
                            mqserver.mux.carrier.the_encoding = encoding;
                            mqserver.mux.carrier.the_callback = callback;
                        };
                    }

                    function doit(state)
                    {
                        for (var info of get_info().connections.values())
                        {
                            reg(info.mqserver, state);
                        }

                        get_info().server.once('warning', function (err, mqserver)
                        {
                            expect(err.message).to.equal('backoff');
                            expect(get_info().get_connid_from_mqserver(mqserver)).not.to.equal(undefined);
                            state.server_warning = true;
                            check(state);
                        });

                        get_info().server.on('warning', function (err)
                        {
                            if (err.message === 'backoff')
                            {
                                if (state.warnings === undefined)
                                {
                                    state.warnings = 0;
                                }
                                state.warnings += 1;
                            }
                        });

                        get_info().clients[0].on('warning', function (err)
                        {
                            expect(err.message).to.be.oneOf([
                                'write EPIPE',
                                'write after end',
                                'carrier stream ended before end message received',
                                'carrier stream finished before duplex finished',
                                'no handlers', // even after we unsubscribe there may be some messages left in server buffer
                                'Cannot call write after a stream was destroyed',
                                'Stream prematurely closed'
                            ]);
                        });

                        get_info().clients[0].on('error', function (err, unused_obj)
                        {
                            expect(err.message).to.be.oneOf([
                                'write after end',
                                'read ECONNRESET',
                                'carrier stream finished before duplex finished',
                                'carrier stream ended before end message received',
                                'write ECANCELED',
                                'write EPIPE',
                                'write ECONNRESET',
                                'Cannot call write after a stream was destroyed',
                                'Stream prematurely closed'
                            ]);
                        });

                        function onpub(err)
                        {
                            if (err)
                            {
                                expect(err.message).to.be.oneOf([
                                    'carrier stream ended before end message received',
                                    'carrier stream finished before duplex finished',
                                    'write after end',
                                    'read ECONNRESET',
                                    'write EPIPE',
                                    'write ECANCELED',
                                    'write ECONNRESET',
                                    'server error'
                                ]);
                            }
                            else
                            {
                                if (state.published === undefined)
                                {
                                    state.published = 0;
                                }
                                state.published += 1;

                                if (state.onpub)
                                {
                                    state.onpub();
                                }
                            }
                        }

                        for (var i=0; i < 3981; i += 1)
                        {
                            get_info().clients[0].publish('foo', onpub).end();
                        }
                    }

                    f(get_info, doit, restore);
                },

                max_open: undefined,

                before_server_ready: before_server_ready
            }, config));
        }

        function full_event(f, before_server_ready)
        {
            /*jshint validthis: true */
            run.call(this, Object.assign(
            {
                test_timeout: 60000,

                only: function (get_info)
                {
                    get_info().setup(1,
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

                    function check(state)
                    {
                        if (state.server_full && state.server_warning)
                        {
                            if (state.done && !state.done_called)
                            {
                                state.done_called = true;
                                state.done();
                            }
                        }
                    }

                    function reg(mqserver, state)
                    {
                        mqserver.on('full', function ()
                        {
                            state.server_full = true;
                            check(state);
                        });
                    }

                    function doit(state)
                    {
                        for (var info of get_info().connections.values())
                        {
                            reg(info.mqserver, state);
                        }

                        get_info().server.on('warning', function warning(err, mqserver)
                        {
                            if (err.message === 'full')
                            {
                                this.removeListener('warning', warning);
                                expect(get_info().get_connid_from_mqserver(mqserver)).not.to.equal(undefined);
                                state.server_warning = true;
                                check(state);
                            }
                        });
                        
                        get_info().server.on('warning', function (err)
                        {
                            if (err.message === 'full')
                            {
                                if (state.warnings === undefined)
                                {
                                    state.warnings = 0;
                                }
                                state.warnings += 1;
                            }
                        });

                        get_info().clients[0].on('warning', function (err)
                        {
                            if (err.response && is_transport('node_http2-duplex'))
                            {
                                expect(err.response.status).to.equal(404);
                            }
                            else
                            {
                                expect(err.message).to.be.oneOf([
                                    'write EPIPE',
                                    'write ECONNRESET',
                                    'write after end',
                                    'carrier stream ended before end message received',
                                    'carrier stream finished before duplex finished',
                                    'Cannot call write after a stream was destroyed',
                                    'Stream prematurely closed'
                                ]);
                            }
                        });

                        get_info().clients[0].on('error', function (err, unused_obj)
                        {
                            if (err.response && is_transport('node_http2-duplex'))
                            {
                                expect(err.response.status).to.equal(404);
                            }
                            else
                            {
                                expect(err.message).to.be.oneOf([
                                    'write after end',
                                    'read ECONNRESET',
                                    'write ECONNRESET',
                                    'carrier stream finished before duplex finished',
                                    'carrier stream ended before end message received',
                                    'write EPIPE',
                                    'write ECONNABORTED',
                                    'Cannot call write after a stream was destroyed',
                                    'Stream prematurely closed'
                                ]);
                            }
                        });

                        function onpub(err)
                        {
                            if (err)
                            {
                                expect(err.message).to.be.oneOf([
                                    'carrier stream ended before end message received',
                                    'carrier stream finished before duplex finished',
                                    'write after end',
                                    'write ECONNRESET',
                                    'read ECONNRESET',
                                    'write EPIPE',
                                    'write ECONNABORTED'
                                ]);
                            }
                            else
                            {
                                if (state.published === undefined)
                                {
                                    state.published = 0;
                                }
                                state.published += 1;

                                if (state.onpub)
                                {
                                    state.onpub();
                                }
                            }
                        }

                        get_info().clients[0].subscribe('foo', function ()
                        {
                            if (state.onmsg)
                            {
                                state.onmsg.apply(this, arguments);
                            }
                        }, function (err)
                        {
                            if (err) { throw err; }

                            state.pub_streams = [];

                            for (var i = 0; i < 1000; i += 1)
                            {
                                var s = get_info().clients[0].publish('foo', onpub);
                                state.pub_streams.push(s);
                                s.write('bar');
                            }
                        });
                    }

                    f(get_info, doit);
                },

                before_server_ready: before_server_ready
            }, config));
        }

        if (!options.relay)
        {
            describe('backoff event', function ()
            {
                backoff_event.call(this, function (get_info, doit, restore)
                {
                    it('should emit a backoff event', function (done)
                    {
                        doit({ done: done, dummy_publish: true });
                    });

                    it('should support closing connection on backoff', function (done)
                    {
                        var backoff = require('../lib/server_extensions/backoff'),
                            bo = get_info().attach_extension(
                                backoff.backoff,
                                { close_conn: true }),
                            state = { dummy_publish: true };

                        get_info().clients[0].mux.on('end', function ()
                        {
                            expect(state.server_backoff).to.equal(true);
                            expect(state.server_warning).to.equal(true);
                            get_info().detach_extension(bo);
                            done();
                        });

                        doit(state);
                    });

                    it('should support delaying responses on backoff', function (done)
                    {
                        var backoff = require('../lib/server_extensions/backoff'),
                            bo = get_info().attach_extension(
                                backoff.backoff,
                                { delay_responses: true }),
                            state = {
                                no_restore: true,
                                maxListeners: 0,
                                done: backedoff
                            },
                            subscribed = false,
                            unsubscribed = false,
                            published = false,
                            unsubscribed_all = false;

                        function gotmsg(s, info)
                        {
                            // fsq may pick up some messages before it processes
                            // unsubscribe requests
                            expect(info.topic).to.equal('foo');
                        }

                        function check(err)
                        {
                            if (err) { return done(err); }

                            if (subscribed &&
                                unsubscribed &&
                                published &&
                                unsubscribed_all)
                            {
                                if (state.published === 3981)
                                {
                                    get_info().detach_extension(bo);
                                    done();
                                }
                                else if (state.published > 3981)
                                {
                                    done(new Error('too many published'));
                                }
                            }
                        }

                        function backedoff()
                        {
                            expect(state.warnings).to.equal(1);

                            get_info().server.on('warning', function warn(err)
                            {
                                expect(err.message).to.equal('backoff');

                                // 1 for foo publish which caused backoff then
                                // 1 each for sub, unsub, pub(foo2), unsub_all
                                if (state.warnings !== 5)
                                {
                                    return;
                                }

                                get_info().server.removeListener('warning', warn);

                                expect(subscribed).to.equal(false);
                                expect(unsubscribed).to.equal(false);
                                expect(published).to.equal(false);
                                expect(unsubscribed_all).to.equal(false);
                                expect(state.published).to.equal(undefined);

                                state.onpub = check;
                                
                                // Other backoff events might be pending so
                                // we don't want an intermediate drain.
                                // This wouldn't happen for real drains since
                                // event handlers are called synchronously
                                // in a for loop. Or at least it would be the
                                // backoff event handler's fault if it provoked
                                // a drain event with others pending.
                                process.nextTick(restore);
                            });

                            get_info().clients[0].subscribe('bar', gotmsg, function (err)
                            {
                                subscribed = true;
                                check(err);
                            });

                            get_info().clients[0].unsubscribe('foo', gotmsg, function (err)
                            {
                                unsubscribed = true;
                                check(err);
                            });

                            get_info().clients[0].unsubscribe(function (err)
                            {
                                unsubscribed_all = true;
                                check(err);
                            });

                            get_info().clients[0].publish('foo2', function (err)
                            {
                                published = true;
                                check(err);
                            }).end('bar2');
                        }

                        get_info().clients[0].subscribe('foo', gotmsg, function (err)
                        {
                            if (err) { return done(err); }
                            get_info().clients[0].subscribe('foo2', gotmsg, function (err)
                            {
                                if (err) { return done(err); }
                                doit(state);
                            });
                        });
                    });
                });
            });

            describe('backoff event (skip message)', function ()
            {
                var skipped = 0, on_skip;

                backoff_event.call(this, function (get_info, doit, restore)
                {
                    it('should support skipping messages on backoff', function (done)
                    {
                        var state = {
                                no_restore: true,
                                done: backedoff
                            },
                            messages = 0;

                        function gotmsg(s, info)
                        {
                            expect(info.topic).to.equal('foo');
                            messages += 1;
                            check();
                        }

                        function check(err)
                        {
                            if (err) { return done(err); }

                            if ((state.published === 3981) &&
                                ((skipped + messages) === 3981))
                            {
                                done();
                            }
                            else if (state.published > 3981)
                            {
                                done(new Error('too many published'));
                            }
                            else if ((skipped + messages) > 3981)
                            {
                                done(new Error('too many skipped + messages'));
                            }
                        }

                        function backedoff()
                        {
                            expect(state.warnings).to.equal(1);

                            on_skip = function ()
                            {
                                if ((skipped > 0) && !state.onpub)
                                {
                                    expect(state.published).to.equal(undefined);
                                    state.onpub = check;
                                    restore();
                                }
                                else
                                {
                                    check();
                                }
                            };
                            on_skip();
                        }

                        get_info().clients[0].subscribe('foo', gotmsg, function (err)
                        {
                            if (err) { return done(err); }
                            doit(state);
                        });
                    });
                }, function (get_info)
                {
                    var backoff = require('../lib/server_extensions/backoff');
                    get_info().attach_extension(
                        backoff.backoff,
                        {
                            skip_message: true,
                            on_skip: function (unused_info)
                            {
                                skipped += 1;
                                if (on_skip)
                                {
                                    on_skip();
                                }
                            }
                        });
                });
            });

            describe('backoff event (delay message)', function ()
            {
                var delayed = 0, on_delay;

                backoff_event.call(this, function (get_info, doit, restore)
                {
                    it('should support delaying messages on backoff', function (done)
                    {
                        var state = {
                                no_restore: true,
                                done: backedoff
                            },
                            messaged = 0;

                        function gotmsg(s, unused_info)
                        {
                            messaged += 1;
                            read_all(s, function ()
                            {
                                check();
                            });
                        }

                        function check(err)
                        {
                            if (err) { return done(err); }

                            if ((messaged === 3981) && (state.published === 3981))
                            {
                                done();
                            }
                            else if (messaged > 3981)
                            {
                                done(new Error('too many messages'));
                            }
                            else if (state.published > 3981)
                            {
                                done(new Error('too many published'));
                            }
                        }

                        function backedoff()
                        {
                            expect(state.warnings).to.equal(1);

                            on_delay = function ()
                            {
                                if (delayed === 3981)
                                {
                                    expect(messaged).to.equal(0);
                                    expect(state.published).to.equal(undefined);

                                    state.onpub = check;

                                    restore();
                                }
                            };
                            on_delay();
                        }

                        get_info().clients[0].subscribe('foo', gotmsg, function (err)
                        {
                            if (err) { return done(err); }
                            doit(state);
                        });
                    });
                }, function (get_info)
                {
                    var backoff = require('../lib/server_extensions/backoff');
                    get_info().attach_extension(
                        backoff.backoff,
                        {
                            delay_message: true,
                            on_delay: function (unused_info)
                            {
                                delayed += 1;
                                if (on_delay)
                                {
                                    on_delay();
                                }
                            }
                        });
                });
            });

            describe('full event (2)', function ()
            {
                full_event.call(this, function (get_info, doit)
                {
                    it('should emit a full event', function (done)
                    {
                        doit({ done: done });
                    });

                    it('should support closing connection on full', function (done)
                    {
                        var full = require('../lib/server_extensions/full'),
                            fl = get_info().attach_extension(
                                full.full,
                                { close_conn: true }),
                            state = {};

                        get_info().clients[0].mux.on('end', function ()
                        {
                            expect(state.server_full).to.equal(true);
                            expect(state.server_warning).to.equal(true);
                            get_info().detach_extension(fl);
                            done();
                        });

                        doit(state);
                    });
                });
            });

            describe('full event (skip message)', function ()
            {
                var skipped = 0, on_skip;

                full_event.call(this, function (get_info, doit)
                {
                    it('should support skipping messages on full', function (done)
                    {
                        var state = {
                                done: full,
                                onmsg: gotmsg
                            },
                            messages = 0;

                        function gotmsg(s, info)
                        {
                            expect(info.topic).to.equal('foo');
                            read_all(s, function (v)
                            {
                                expect(v.toString()).to.equal('bar');
                                messages += 1;
                                check();
                            });
                        }

                        function check(err)
                        {
                            if (err) { return done(err); }

                            if ((state.published === 1000) &&
                                ((skipped + messages) === 1001))
                            {
                                done();
                            }
                            else if (state.published > 1000)
                            {
                                done(new Error('too many published'));
                            }
                            else if ((skipped + messages) > 1001)
                            {
                                done(new Error('too many skipped + messages'));
                            }
                        }

                        function full()
                        {
                            expect(state.warnings).to.equal(1);

                            on_skip = function ()
                            {
                                if ((skipped > 0) && !state.onpub)
                                {
                                    expect(state.published).to.equal(undefined);
                                    state.onpub = check;
                                    for (var s of state.pub_streams)
                                    {
                                        s.end();
                                    }
                                }
                                else
                                {
                                    check();
                                }
                            };
                            on_skip();

                            get_info().server.fsq.publish(get_info().connections.values().next().value.prefixes[0] + 'foo').end('bar');
                        }

                        doit(state);
                    });
                }, function (get_info)
                {
                    var full = require('../lib/server_extensions/full');
                    get_info().attach_extension(
                        full.full,
                        {
                            skip_message: true,
                            on_skip: function (unused_info)
                            {
                                skipped += 1;
                                if (on_skip)
                                {
                                    on_skip();
                                }
                            }
                        });
                });
            });

            describe('full event (delay message)', function ()
            {
                var delayed = 0, on_delay;

                full_event.call(this, function (get_info, doit)
                {
                    it('should support delaying messages on full', function (done)
                    {
                        var state = {
                                done: full,
                                onmsg: gotmsg
                            },
                            messages = 0;

                        function gotmsg(s, info)
                        {
                            expect(info.topic).to.equal('foo');
                            read_all(s, function (v)
                            {
                                expect(v.toString()).to.equal('bar');
                                messages += 1;
                                check();
                            });
                        }

                        function check(err)
                        {
                            if (err) { return done(err); }

                            if ((state.published === 1000) &&
                                (messages === 1001))
                            {
                                done();
                            }
                            else if (state.published > 1000)
                            {
                                done(new Error('too many published'));
                            }
                            else if (messages > 1001)
                            {
                                done(new Error('too many messages'));
                            }
                        }

                        function full()
                        {
                            expect(state.warnings).to.equal(1);

                            on_delay = function ()
                            {
                                if ((delayed > 0) && !state.onpub)
                                {
                                    expect(state.published).to.equal(undefined);
                                    state.onpub = check;
                                    for (var s of state.pub_streams)
                                    {
                                        s.end();
                                    }
                                }
                            };
                            on_delay();

                            get_info().server.fsq.publish(get_info().connections.values().next().value.prefixes[0] + 'foo').end('bar');
                        }

                        doit(state);
                    });
                }, function (get_info)
                {
                    var full = require('../lib/server_extensions/full');
                    get_info().attach_extension(
                        full.full,
                        {
                            delay_message: true,
                            on_delay: function (unused_info)
                            {
                                delayed += 1;
                                if (on_delay)
                                {
                                    on_delay();
                                }
                            }
                        });
                });
            });
        }

        describe('close connection on authorization error', function ()
        {
            run.call(this, Object.assign(
            {
                only: function (get_info)
                {
                    get_info().setup(1,
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

                        client_function: get_info().client_function,
                        skip_ready: true
                    });

                    it('should close connection if error occurs on it during authorization', get_info().expect_error('foo', is_transport('tcp') ? 1 : true));
                },

                before_server_ready: function (get_info)
                {
                    var ccoe = require('../lib/server_extensions/close_conn_on_error');
                    get_info().attach_extension(ccoe.close_conn_on_error);

                    get_info().server.once('authz_start', function (cancel, onclose, obj)
                    {
                        obj.emit('error', new Error('foo'));
                    });

                    get_info().server.once('authz_end', function (err)
                    {
                        expect(err.message).to.equal('foo');
                    });
                }
            }, config));
        });

        function allowed_algs(algs, errmsg)
        {
            /*jshint validthis: true */
            run.call(this, Object.assign({}, config,
            {
                only: function (get_info)
                {
                    get_info().setup(1,
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

                        skip_ready: !(options.anon && !errmsg),
                        client_function: (options.anon && !errmsg) ? undefined : get_info().client_function
                    });

                    if (options.anon && !errmsg)
                    {
                        it('should authorize', function (done)
                        {
                            done();
                        });
                    }
                    else
                    {
                        it('should fail to authorize', get_info().expect_error(errmsg || 'algorithm not allowed: PS256'));
                    }
                },

                allowed_algs: algs
            }));
        }

        describe('no allowed algorithms', function ()
        {
            allowed_algs.call(this, []);
        });

        describe('null allowed algorithms', function ()
        {
            allowed_algs.call(this, null, "Cannot read property 'concat' of null");
        });

        describe('undefined allowed algorithms', function ()
        {
            allowed_algs.call(this, undefined, "Cannot read property 'concat' of undefined");
        });
    });
};
