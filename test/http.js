/*jshint mocha: true */
"use strict";

var runner = require('./runner'),
    centro = require('..'),
    read_all = require('./read_all'),
    http = require('http'),
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
    extra: function ()
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
    }
});
