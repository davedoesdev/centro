/*jshint mocha: true */
"use strict";

var runner = require('./runner'),
    centro = require('..'),
    read_all = require('./read_all'),
    http = require('http'),
    jsjws = require('jsjws'),
    querystring = require('querystring'),
    expect = require('chai').expect,
    port = 8700;

function make_token(get_info)
{
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
                allow: ['foo'],
                disallow: []
            },
            subscribe: {
                allow: ['foo'],
                disallow: []
            }
        }
    }, token_exp, get_info().priv_key);
}

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

                        return http.request(
                        {
                            port: port,
                            auth: userpass,
                            method: 'POST',
                            path: '/publish?' + querystring.stringify(Object.assign(
                                    {}, options, { topic: topic, n: n }))
                        }, function (res)
                        {
                            var msg = '';

                            res.on('end', function ()
                            {
                                var err;

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
        http.request(
        {
            port: port,
            method: 'POST',
            path: '/dummy'
        }, function (res)
        {
            expect(res.statusCode).to.equal(404);
            read_all(res, function (v)
            {
                expect(v.toString()).to.equal('not found');
                done();
            });
        }).end();
    });

    it('should return 401 for authorise error', function (done)
    {
        http.request(
        {
            port: port,
            method: 'POST',
            path: '/publish'
        }, function (res)
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
        get_info().server.once('connect', function (info)
        {
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
        
        centro.separate_auth(
        {
            token: make_token(get_info)
        }, function (err, userpass)
        {
            http.request(
            {
                port: port,
                auth: userpass,
                method: 'POST',
                path: '/publish?' + querystring.stringify(
                {
                    topic: 'foo',
                    ttl: ['foo', 'foo']
                })
            }, function (res)
            {
                expect(res.statusCode).to.equal(200);
                read_all(res, function (v)
                {
                    expect(v.toString()).to.equal('');
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
            http.request(
            {
                port: port,
                auth: userpass,
                method: 'POST',
                path: '/publish?' + querystring.stringify(
                {
                    topic: 'foo',
                })
            }, function (res)
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
            http.request(
            {
                port: port,
                auth: userpass,
                method: 'POST',
                path: '/publish?' + querystring.stringify(
                {
                    topic: 'foo',
                })
            }, function (res)
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
            http.request(
            {
                port: port,
                auth: userpass,
                method: 'POST',
                path: '/publish?' + querystring.stringify(
                {
                    topic: 'foo',
                })
            }, function (res)
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
}

runner(
{
    transport: [{
        server: 'http',
        config: {
            port: port
        }
    }, {
        server: 'in-mem'
    }],
    transport_name: 'http'
}, connect,
{
    relay: true,
    extra: extra
});

runner(
{
    transport: [{
        server: 'http',
        config: {
            port: port
        }
    }, {
        server: 'in-mem'
    }],
    transport_name: 'http_passed_in_server'
}, connect,
{
    relay: true,
    extra: function (get_info, on_before)
    {
        extra(get_info, on_before);

        it('should catch errors when writing response', function (done)
        {
            get_info().server.once('connect', function (info)
            {
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
                http.request(
                {
                    port: port,
                    auth: userpass,
                    method: 'POST',
                    path: '/publish?' + querystring.stringify(
                    {
                        topic: 'foo',
                    })
                }, function (res)
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

        it('should catch errors when publishing', function (done)
        {
            get_info().server.once('connect', function (info)
            {
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

                    throw new Error('dummy');
                };
            }

            get_info().config.server.on('request', request);

            centro.separate_auth(
            {
                token: make_token(get_info)
            }, function (err, userpass)
            {
                http.request(
                {
                    port: port,
                    auth: userpass,
                    method: 'POST',
                    path: '/publish?' + querystring.stringify(
                    {
                        topic: 'foo',
                    })
                }, function (res)
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

        it('should handle request errors', function (done)
        {
            get_info().server.once('connect', function (info)
            {
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
                http.request(
                {
                    port: port,
                    auth: userpass,
                    method: 'POST',
                    path: '/publish?' + querystring.stringify(
                    {
                        topic: 'foo',
                    })
                }, function (res)
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
            get_info().server.once('connect', function (info)
            {
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
                http.request(
                {
                    port: port,
                    auth: userpass,
                    method: 'POST',
                    path: '/publish?' + querystring.stringify(
                    {
                        topic: 'foo',
                    })
                }, function (res)
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
                            http.request(
                            {
                                port: port,
                                auth: userpass,
                                method: 'POST',
                                path: '/publish?' + querystring.stringify(
                                {
                                    topic: 'foo',
                                })
                            }, function (res)
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

        config.server = http.createServer();
        config.server.listen(port, cb);
    },

    on_after: function (config, cb)
    {
        config.server.close(cb);
    }
});
