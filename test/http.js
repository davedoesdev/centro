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
}, function (config, server, cb)
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
},
{
    relay: true,
    extra: function (get_info)
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

        function make_token()
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

        it('should handle bad ttl value', function (done)
        {
            get_info().server.once('connect', function (info)
            {
                info.mqserver.once('publish_requested', function (topic, duplex, options, done)
                {
                    expect(topic).to.equal(info.prefixes[0] + 'foo');
                    expect(options.single).to.equal(false);
                    expect(options.ttl).to.equal(undefined);
                    read_all(duplex, function (v)
                    {
                        expect(v.toString()).to.equal('hello');
                        done();
                    });
                });
            });
            
            centro.separate_auth(
            {
                token: make_token()
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

		// close while publish
    }
});
