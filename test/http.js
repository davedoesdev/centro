/*jshint mocha: true */
"use strict";

var runner = require('./runner'),
    centro = require('..'),
    read_all = require('./read_all'),
    jsjws = require('jsjws'),
    querystring = require('querystring'),
    expect = require('chai').expect,
    pub_pathname = '/centro/v' + centro.version + '/publish?',
    sub_pathname = '/centro/v' + centro.version + '/subscribe?',
    path = require('path'),
    fs = require('fs'),
    readline = require('readline'),
    PassThrough = require('stream').PassThrough,
    port = 8700;

function make_token(get_info, topic)
{
    topic = topic || 'foo';
    var token_exp = new Date();
    token_exp.setMinutes(token_exp.getMinutes() + 1);
    return new jsjws.JWT().generateJWTByKey(
    {
        alg: 'PS256'
    },
    {
        iss: get_info().issuer_id,
        access_control: {
            publish: {
                allow: [topic],
                disallow: []
            },
            subscribe: {
                allow: [topic],
                disallow: []
            }
        }
    }, token_exp, get_info().priv_key);
}

function setup(mod, transport_config, client_config, server_config)
{

function connect(config, server, cb)
{
    centro.separate_auth(config, function (err, userpass)
    {
        if (err)
        {
            return cb(err);
        }

        server.transport_ops[1].connect(function (err, stream)
        {
            if (err)
            {
                return cb(err);
            }

            var mqclient = centro.stream_auth(stream, config);

            if (mqclient)
            {
                mqclient.on('ready', function ()
                {
                    this.publish = function (n, topic, options, cb)
                    {
                        if (typeof n !== 'number')
                        {
                            cb = options;
                            options = topic;
                            topic = n;
                            n = 0;
                        }

                        if (typeof options === 'function')
                        {
                            cb = options;
                            options = undefined;
                        }

                        return require(mod).request(Object.assign(
                        {
                            port: port,
                            auth: userpass,
                            method: 'POST',
                            path: pub_pathname + querystring.stringify(Object.assign(
                                    {}, options, { topic: topic, n: n }))
                        }, client_config), function (res)
                        {
                            var msg = '';

                            res.on('end', function ()
                            {
                                var err = null;

                                if (res.statusCode === 200)
                                {
                                    expect(msg).to.equal('');
                                }
                                else
                                {
                                    err = new Error(msg);
                                }

                                if (cb)
                                {
                                    cb(err);
                                }
                                else if (err)
                                {
                                    mqclient._warning(err);
                                }
                            });

                            if (cb)
                            {
                                res.on('error', cb);
                            }
                            else
                            {
                                res.on('error', mqclient._warning);
                            }

                            res.on('readable', function ()
                            {
                                var r = this.read();
                                if (r !== null)
                                {
                                    msg += r.toString();
                                }
                            });
                        });
                    };

                    var nsubs = [];

                    function destroy_responses(n, topic, handlers)
                    {
                        for (var handler of handlers)
                        {
                            if (handler.centro_test_responses &&
                                handler.centro_test_responses[n])
                            {
                                var res = handler.centro_test_responses[n].get(topic);
                                if (res)
                                {
                                    res.destroy();
                                }
                            }
                        }
                    }

                    this.subscribe = function (n, topic, handler, cb)
                    {
                        if (typeof n === 'string')
                        {
                            cb = handler;
                            handler = topic;
                            topic = n;
                            n = 0;
                        }

                        cb = cb || function () {};

                        var subs;

                        if (typeof topic === 'string')
                        {
                            subs = nsubs[n];
                            if (!subs)
                            {
                                subs = nsubs[n] = new Map();
                            }

                            var handlers = subs.get(topic);
                            if (!handlers)
                            {
                                handlers = new Set();
                                subs.set(topic, handlers);
                            } else if (handlers.has(handler))
                            {
                                return cb();
                            }
                            handlers.add(handler);
                        }
                        else
                        {
                            subs = new Map();
                            for (var t of topic)
                            {
                                subs.set(t, new Set([handler]));
                            }
                        }
                        
                        require(mod).request(Object.assign(
                        {
                            port: port,
                            auth: userpass,
                            method: 'GET',
                            path: sub_pathname + querystring.stringify(
                                    { topic: topic, n: n })
                        }, client_config), function (res)
                        {
                            if (res.statusCode !== 200)
                            {
                                var msg = '';

                                res.on('end', function ()
                                {
                                    var err = new Error(msg);
                                    if (cb)
                                    {
                                        cb(err);
                                    }
                                    else
                                    {
                                        mqclient._warning(err);
                                    }
                                });

                                if (cb)
                                {
                                    res.on('error', cb);
                                }
                                else
                                {
                                    res.on('error', mqclient._warning);
                                }

                                return res.on('readable', function ()
                                {
                                    var r = this.read();
                                    if (r !== null)
                                    {
                                        msg += r.toString();
                                    }
                                });
                            }

                            if (!handler.centro_test_responses)
                            {
                                handler.centro_test_responses = [];
                            }
                            if (!handler.centro_test_responses[n])
                            {
                                handler.centro_test_responses[n] = new Map();
                            }
                            handler.centro_test_responses[n].set(topic, res);

                            var rl = readline.createInterface(
                            {
                                input: res
                            }), ev = '', passthrus = new Map();

                            rl.on('line', function (line)
                            {
                                var pthru;

                                if (line === ':ok')
                                {
                                    cb(null);
                                }
                                else if (line === 'event: start')
                                {
                                    ev = 'start';
                                }
                                else if (line === 'event: data')
                                {
                                    ev = 'data';
                                }
                                else if (line === 'event: end')
                                {
                                    ev = 'end';
                                }
                                else if (line === 'event: peer_error')
                                {
                                    ev = 'peer_error';
                                }
                                else if (line.lastIndexOf('data:') === 0)
                                {
                                    var info = JSON.parse(line.substr(6));

                                    if (ev === 'start')
                                    {
                                        var handlers = subs.get(typeof topic === 'string' ? topic : info.topic);
                                        if (handlers && handlers.has(handler))
                                        {
                                            pthru = new PassThrough();
                                            passthrus.set(info.id, pthru);
                                            handler.call(mqclient, pthru, info, function (err)
                                            {
                                                if (err)
                                                {
                                                    mqclient._warning(err);
                                                }
                                            });
                                        }
                                    }
                                    else if (ev === 'data')
                                    {
                                        pthru = passthrus.get(info.id);
                                        if (pthru && !pthru.write(new Buffer(info.data, 'binary')))
                                        {
                                            pthru.once('drain', function ()
                                            {
                                                rl.resume();
                                            });
                                            rl.pause();
                                        }
                                    }
                                    else if (ev === 'end')
                                    {
                                        pthru = passthrus.get(info.id);
                                        if (pthru)
                                        {
                                            passthrus.get(info.id).end();
                                            passthrus.delete(info.id);
                                        }
                                    }
                                    else if (ev === 'peer_error')
                                    {
                                        pthru = passthrus.get(info.id);
                                        var err = new Error('peer error');
                                        mqclient.emit('error', err, pthru);
                                        if (pthru && (pthru.listenerCount('error') > 0))
                                        {
                                            pthru.emit('error', err);
                                        }
                                    }
                                }
                            });
                        }).end();
                    };

                    this.unsubscribe = function (n, topic, handler, cb)
                    {
						if (typeof n !== 'number')
						{
							cb = handler;
							handler = topic;
							topic = n;
							n = 0;
						}

						if (typeof topic === 'function')
						{
							cb = topic;
							topic = undefined;
							handler = undefined;
						}

                        cb = cb || function () {};

                        var subs = nsubs[n];
                        if (!subs)
                        {
                            subs = nsubs[n] = new Map();
                        }

                        if (topic === undefined)
                        {
                            for (var topic_handlers of subs)
                            {
                                destroy_responses(n, topic_handlers[0], topic_handlers[1]);
                            }
                            subs.clear();
                        }
                        else
                        {
                            var handlers = subs.get(topic);
                            if (handlers)
                            {
                                if (handler === undefined)
                                {
                                    destroy_responses(n, topic, handlers);
                                    handlers.clear();
                                }
                                else
                                {
                                    destroy_responses(n, topic, [handler]);
                                    handlers.delete(handler);
                                }
                            }
                        }

                        // give time for server to close
                        setTimeout(cb, 500);
                    };
                });
            }

            cb(null, mqclient);
        });
    });
}

function extra(get_info, on_before)
{
    it('should return 404 for unknown path', function (done)
    {
        require(mod).request(Object.assign(
        {
            port: port,
            method: 'POST',
            path: '/dummy'
        }, client_config), function (res)
        {
            expect(res.statusCode).to.equal(404);
            read_all(res, function (v)
            {
                expect(v.toString()).to.equal('not found');
                done();
            });
        }).end();
    });

    it('should return 405 for non-POSTs to publish', function (done)
    {
        require(mod).request(Object.assign(
        {
            port: port,
            method: 'GET',
            path: pub_pathname
        }, client_config), function (res)
        {
            expect(res.statusCode).to.equal(405);
            read_all(res, function (v)
            {
                expect(v.toString()).to.equal('method not allowed');
                done();
            });
        }).end();
    });

    it('should return 405 for non-GETs to subscribe', function (done)
    {
        require(mod).request(Object.assign(
        {
            port: port,
            method: 'POST',
            path: sub_pathname
        }, client_config), function (res)
        {
            expect(res.statusCode).to.equal(405);
            read_all(res, function (v)
            {
                expect(v.toString()).to.equal('method not allowed');
                done();
            });
        }).end();
    });

    it('should return 403 for invalid CORS request', function (done)
    {
        require(mod).request(Object.assign(
        {
            port: port,
            method: 'GET',
            path: sub_pathname,
            headers: {
                origin: '%'
            }
        }, client_config), function (res)
        {
            expect(res.statusCode).to.equal(403);
            read_all(res, function (v)
            {
                expect(v.toString()).to.equal('Invalid HTTP Access Control (CORS) request:\n  Origin: %\n  Method: GET');
                done();
            });
        }).end();
    });

    if (get_info().config.transport[0].config.sse_keep_alive_interval)
    {
        it('should send periodic keep-alive comment', function (done)
        {
            centro.separate_auth(
            {
                token: make_token(get_info, 'sspkac')
            }, function (err, userpass)
            {
                require(mod).request(Object.assign(
                {
                    port: port,
                    auth: userpass,
                    method: 'GET',
                    path: sub_pathname + querystring.stringify(
                    {
                        topic: 'sspkac'
                    })
                }, client_config), function (res)
                {
                    expect(res.statusCode).to.equal(200);

                    var rl = readline.createInterface(
                    {
                        input: res
                    }), lines = [];

                    rl.on('line', function (line)
                    {
                        lines.push(line);
                    });

                    setTimeout(function ()
                    {
                        expect(lines).to.eql([':ok', '', ':ka', '', ':ka', '']);
                        res.destroy();
                        done();
                    }, 2500);
                }).end();
            });
        });
    }
    else
    {
        it('should not send periodic keep-alive comment', function (done)
        {
            centro.separate_auth(
            {
                token: make_token(get_info, 'snspkac')
            }, function (err, userpass)
            {
                require(mod).request(Object.assign(
                {
                    port: port,
                    auth: userpass,
                    method: 'GET',
                    path: sub_pathname + querystring.stringify(
                    {
                        topic: 'snspkac'
                    })
                }, client_config), function (res)
                {
                    expect(res.statusCode).to.equal(200);

                    var rl = readline.createInterface(
                    {
                        input: res
                    }), lines = [];

                    rl.on('line', function (line)
                    {
                        lines.push(line);
                    });

                    setTimeout(function ()
                    {
                        expect(lines).to.eql([':ok', '']);
                        res.destroy();
                        done();
                    }, 2000);
                }).end();
            });
        });
    }

    it('should return 401 for authorise error', function (done)
    {
        require(mod).request(Object.assign(
        {
            port: port,
            method: 'POST',
            path: pub_pathname
        }, client_config), function (res)
        {
            expect(res.statusCode).to.equal(401);
            expect(res.headers['www-authenticate']).to.equal('Basic realm="centro"');
            read_all(res, function (v)
            {
                expect(v.toString()).to.equal('tokens missing');
                done();
            });
        }).end();
    });

    it('should handle bad ttl value', function (done)
    {
        centro.separate_auth(
        {
            token: make_token(get_info)
        }, function (err, userpass)
        {
            require(mod).request(Object.assign(
            {
                port: port,
                auth: userpass,
                method: 'POST',
                path: pub_pathname + querystring.stringify(
                {
                    topic: 'foo',
                    ttl: ['foo', 'foo']
                })
            }, client_config), function (res)
            {
                expect(res.statusCode).to.equal(400);
                read_all(res, function (v)
                {
                    expect(v.toString()).to.equal('data.ttl should be integer');
                    done();
                });
            }).end('hello');
        });
    });

    it('should return 503 when closed while authorizing', function (done)
    {
        var orig_authorize = get_info().server.transport_ops[0].authz.authorize;

        get_info().server.transport_ops[0].authz.authorize = function ()
        {
            var self = this,
            args = Array.prototype.slice.call(arguments);

            get_info().server.close(function (err)
            {
                if (err) { throw err; }
                orig_authorize.apply(self, args);
            });
        };

        centro.separate_auth(
        {
            token: make_token(get_info)
        }, function (err, userpass)
        {
            require(mod).request(Object.assign(
            {
                port: port,
                auth: userpass,
                method: 'POST',
                path: pub_pathname + querystring.stringify(
                {
                    topic: 'foo',
                })
            }, client_config), function (res)
            {
                expect(res.statusCode).to.equal(503);
                read_all(res, function (v)
                {
                    expect(v.toString()).to.equal('closed');
                    on_before(done); 
                });
            }).end('hello');
        });
    });

    it('should return 503 if error occurs while checking revision', function (done)
    {
        var orig_get_pub_key_by_uri = get_info().server.transport_ops[0].authz.keystore.get_pub_key_by_uri;

        get_info().server.transport_ops[0].authz.keystore.get_pub_key_by_uri = function (uri, cb)
        {
            this.get_pub_key_by_uri = orig_get_pub_key_by_uri;
            cb(new Error('dummy'));
        };

        centro.separate_auth(
        {
            token: make_token(get_info)
        }, function (err, userpass)
        {
            require(mod).request(Object.assign(
            {
                port: port,
                auth: userpass,
                method: 'POST',
                path: pub_pathname + querystring.stringify(
                {
                    topic: 'foo',
                })
            }, client_config), function (res)
            {
                expect(res.statusCode).to.equal(503);
                read_all(res, function (v)
                {
                    expect(v.toString()).to.equal('closed');
                    done();
                });
            }).end('hello');
        });
    });

    it('ended before onclose (3)', function (done)
    {
        centro.separate_auth(
        {
            token: make_token(get_info)
        }, function (err, userpass)
        {
            var orig_set = get_info().server._connids.set;
            get_info().server._connids.set = function (connid, dstroy)
            {
                get_info().server._connids.set = orig_set;
                dstroy.stream.push(null);
                dstroy();
                orig_set.call(this, connid, dstroy);
            };
            require(mod).request(Object.assign(
            {
                port: port,
                auth: userpass,
                method: 'POST',
                path: pub_pathname + querystring.stringify(
                {
                    topic: 'foo',
                })
            }, client_config), function (res)
            {
                expect(res.statusCode).to.equal(503);
                read_all(res, function (v)
                {
                    expect(v.toString()).to.equal('closed');
                    done();
                });
            }).end('hello');
        });
    });
    
    describe('multiple topics', function ()
    {
        get_info().setup(2,
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

        it('should support subscribing to multiple topics', function (done)
        {
            var foo = false, bar = false;

            get_info().clients[1].subscribe([0, 1], ['foo', 'bar'], function (s, info)
            {
                read_all(s, function (data)
                {
                    expect(data.toString()).to.equal(info.topic === 'foo' ?
                            'bar' : 'fooey');
                    if (info.topic === 'foo')
                    {
                        foo = true;
                    }
                    else if (info.topic === 'bar')
                    {
                        bar = true;
                    }
                    if (foo && bar)
                    {
                        done();
                    }
                });
            }, function (err)
            {
                if (err) { return done(err); }
                get_info().clients[0].publish('foo', function (err)
                {
                    if (err) { return done(err); }
                    get_info().clients[1].publish(1, 'bar', function (err)
                    {
                        if (err) { return done(err); }
                    }).end('fooey');
                }).end('bar');
            });
        });
    });
}

runner(
{
    transport: [{
        server: 'http',
        config: transport_config,
        name: mod
    }, 'in-mem'],
}, connect,
{
    relay: true,
    extra: extra
});

runner(
{
    transport: [{
        server: 'http',
        config: Object.assign(
        {
            sse_keep_alive_interval: 1
        }, transport_config),
        name: mod + '_passed_in_server'
    }, {
        server: 'in-mem'
    }],
}, connect,
{
    relay: true,
    extra: function (get_info, on_before)
    {
        extra(get_info, on_before);

        it('should catch errors when writing response', function (done)
        {
            get_info().server.once('connect', function (connid)
            {
                var info = get_info().connections.get(connid);
                // make sure another test doesn't pick up the message
                info.mqserver.once('publish_requested', function (topic, duplex, options, done2)
                {
                    expect(topic).to.equal(info.prefixes[0] + 'foo');
                    expect(options.single).to.equal(false);
                    expect(options.ttl).to.equal(undefined);
                    read_all(duplex, function (v)
                    {
                        expect(v.toString()).to.equal('hello');
                        done2();
                    });
                });
            });

            var msg;

            function request(req, res)
            {
                /*jshint validthis: true */
                this.removeListener('request', request);

                var orig_writeHead = res.writeHead;
                res.writeHead = function (code, headers)
                {
                    res.writeHead = orig_writeHead;

                    get_info().server.once('warning', function (err)
                    {
                        msg = err.message;
                    });

                    throw new Error('dummy');
                };
            }

            get_info().config.server.on('request', request);

            centro.separate_auth(
            {
                token: make_token(get_info)
            }, function (err, userpass)
            {
                require(mod).request(Object.assign(
                {
                    port: port,
                    auth: userpass,
                    method: 'POST',
                    path: pub_pathname + querystring.stringify(
                    {
                        topic: 'foo',
                    })
                }, client_config), function (res)
                {
                    expect(res.statusCode).to.equal(200);
                    read_all(res, function (v)
                    {
                        expect(v.toString()).to.equal('');
                        expect(msg).to.equal('dummy');
                        done();
                    });
                }).end('hello');
            });
        });

        it('should catch errors when ending response', function (done)
        {
            get_info().server.once('connect', function (connid)
            {
                var info = get_info().connections.get(connid);
                // make sure another test doesn't pick up the message
                info.mqserver.once('publish_requested', function (topic, duplex, options, done2)
                {
                    expect(topic).to.equal(info.prefixes[0] + 'foo');
                    expect(options.single).to.equal(false);
                    expect(options.ttl).to.equal(undefined);
                    read_all(duplex, function (v)
                    {
                        expect(v.toString()).to.equal('hello');
                        done2();
                    });
                });
            });

            var msg;

            function request(req, res)
            {
                /*jshint validthis: true */
                this.removeListener('request', request);

                var orig_end = res.end;
                res.end = function ()
                {
                    res.end = orig_end;

                    get_info().server.once('warning', function (err)
                    {
                        msg = err.message;
                    });

                    throw new Error('dummy2');
                };
            }

            get_info().config.server.on('request', request);

            centro.separate_auth(
            {
                token: make_token(get_info)
            }, function (err, userpass)
            {
                require(mod).request(Object.assign(
                {
                    port: port,
                    auth: userpass,
                    method: 'POST',
                    path: pub_pathname + querystring.stringify(
                    {
                        topic: 'foo',
                    })
                }, client_config), function (res)
                {
                    expect(res.statusCode).to.equal(200);
                    read_all(res, function (v)
                    {
                        expect(v.toString()).to.equal('');
                        expect(msg).to.equal('dummy2');
                        done();
                    });
                }).end('hello');
            });
        });

        it('should not return 200 status if response ends before subscribed', function (done)
        {
            var response;

            get_info().server.once('connect', function (connid)
            {
                var info = get_info().connections.get(connid);
                info.mqserver.once('subscribe_requested', function (topic, done)
                {
                    response.emit('close');
                    this.subscribe(topic, done);
                    response.writeHead(500);
                    response.end('server error');
                });
            });

            function request(req, res)
            {
                /*jshint validthis: true */
                this.removeListener('request', request);
                response = res;
            }

            get_info().config.server.on('request', request);

            centro.separate_auth(
            {
                token: make_token(get_info)
            }, function (err, userpass)
            {
                require(mod).request(Object.assign(
                {
                    port: port,
                    auth: userpass,
                    method: 'GET',
                    path: sub_pathname + querystring.stringify(
                    {
                        topic: 'foo',
                    })
                }, client_config), function (res)
                {
                    expect(res.statusCode).to.equal(500);
                    read_all(res, function (v)
                    {
                        expect(v.toString()).to.equal('server error');
                        done();
                    });
                }).end();
            });
        });

        it('should handle request errors', function (done)
        {
            get_info().server.once('connect', function (connid)
            {
                var info = get_info().connections.get(connid);
                info.mqserver.once('publish_requested', function (topic, duplex, options, done2)
                {
                    // handshake is sent after carrier finishes
                    done(new Error('should not be called'));
                });
            });

            var msg;

            function request(req, res)
            {
                /*jshint validthis: true */
                this.removeListener('request', request);

                var orig_pipe = req.pipe;
                req.pipe = function (dest)
                {
                    req.pipe = orig_pipe;

                    get_info().server.once('warning', function (err)
                    {
                        msg = err.message;
                    });

                    req.emit('error', new Error('dummy'));
                };
            }

            get_info().config.server.on('request', request);

            centro.separate_auth(
            {
                token: make_token(get_info)
            }, function (err, userpass)
            {
                require(mod).request(Object.assign(
                {
                    port: port,
                    auth: userpass,
                    method: 'POST',
                    path: pub_pathname + querystring.stringify(
                    {
                        topic: 'foo',
                    })
                }, client_config), function (res)
                {
                    expect(res.statusCode).to.equal(500);
                    read_all(res, function (v)
                    {
                        expect(v.toString()).to.equal('server error');
                        expect(msg).to.equal('dummy');
                        done();
                    });
                }).end('hello');
            });
        });

        it('should handle response errors', function (done)
        {
            get_info().server.once('connect', function (connid)
            {
                var info = get_info().connections.get(connid);
                info.mqserver.once('publish_requested', function (topic, duplex, options, done2)
                {
                    // handshake is sent after carrier finishes
                    done(new Error('should not be called'));
                });
            });

            var msg;

            function request(req, res)
            {
                /*jshint validthis: true */
                this.removeListener('request', request);

                var orig_pipe = req.pipe;
                req.pipe = function (dest)
                {
                    req.pipe = orig_pipe;

                    get_info().server.once('warning', function (err)
                    {
                        msg = err.message;
                    });

                    res.emit('error', new Error('dummy'));
                    req.emit('error', new Error('dummy2'));
                };
            }

            get_info().config.server.on('request', request);

            centro.separate_auth(
            {
                token: make_token(get_info)
            }, function (err, userpass)
            {
                require(mod).request(Object.assign(
                {
                    port: port,
                    auth: userpass,
                    method: 'POST',
                    path: pub_pathname + querystring.stringify(
                    {
                        topic: 'foo',
                    })
                }, client_config), function (res)
                {
                    expect(res.statusCode).to.equal(500);
                    read_all(res, function (v)
                    {
                        expect(v.toString()).to.equal('server error');
                        expect(msg).to.equal('dummy');
                        done();
                    });
                }).end('hello');
            });
        });

        it('should not publish if request errors', function (done)
        {
            get_info().server.transport_ops[1].connect(function (err, stream)
            {
                if (err) { return done(err); }

                var mqclient = centro.stream_auth(stream,
                {
                    token: make_token(get_info)
                });

                mqclient.on('ready', function ()
                {
                    this.subscribe('foo', function ()
                    {
                        done(new Error('should not be called'));
                    }, function (err)
                    {
                        if (err) { return done(err); }

                        var msg;

                        function request(req, res)
                        {
                            /*jshint validthis: true */
                            this.removeListener('request', request);

                            var orig_pipe = req.pipe;
                            req.pipe = function (dest)
                            {
                                req.pipe = orig_pipe;

                                get_info().server.once('warning', function (err)
                                {
                                    msg = err.message;
                                });

                                dest.write('hello');

                                // let the handshake (and data) go
                                setImmediate(function ()
                                {
                                    req.emit('error', new Error('dummy'));
                                    dest.end();
                                });
                            };
                        }

                        get_info().config.server.on('request', request);

                        centro.separate_auth(
                        {
                            token: make_token(get_info)
                        }, function (err, userpass)
                        {
                            require(mod).request(Object.assign(
                            {
                                port: port,
                                auth: userpass,
                                method: 'POST',
                                path: pub_pathname + querystring.stringify(
                                {
                                    topic: 'foo',
                                })
                            }, client_config), function (res)
                            {
                                expect(res.statusCode).to.equal(500);
                                read_all(res, function (v)
                                {
                                    expect(v.toString()).to.equal('server error');
                                    expect(msg).to.equal('dummy');
                                    setTimeout(function ()
                                    {
                                        stream.on('end', done);
                                        stream.end();
                                    }, 1000);
                                });
                            }).end('hello');
                        });
                    });
                });
            });
        });
    },

    on_before: function (config, cb)
    {
        if (config.server)
        {
            return cb();
        }

        if (server_config)
        {
            config.server = require(mod).createServer(server_config);
        }
        else
        {
            config.server = require(mod).createServer();
        }

        config.server.listen(port, cb);
    },

    on_after: function (config, cb)
    {
        config.server.close(cb);
    }
});

}

setup('http', { port: port });

setup('https',
{
    port: port,
    key: fs.readFileSync(path.join(__dirname, 'server.key')),
    cert: fs.readFileSync(path.join(__dirname, 'server.pem'))
},
{
    agent: new (require('https').Agent)(),
    ca: fs.readFileSync(path.join(__dirname, 'ca.pem'))
},
{
    key: fs.readFileSync(path.join(__dirname, 'server.key')),
    cert: fs.readFileSync(path.join(__dirname, 'server.pem'))
});
