"use strict";

var runner = require('./runner'),
    centro = require('..'),
    http = require('http'),
    querystring = require('querystring'),
    expect = require('chai').expect;

runner(
{
    transport: [{
        server: 'http',
        config: {
            port: 8700
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
                            port: 8700,
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
    relay: true
});
