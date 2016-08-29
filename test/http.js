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

            mqclient.on('ready', function ()
            {
                this.publish = function (topic, options, cb)
                {
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
                                {}, options, { topic: topic }))
                    }, function (res)
                    {
                        if (cb)
                        {
                            res.on('error', cb);
                            res.on('end', cb);
                        }
                        else
                        {
                            res.on('error', mqclient._warning);
                        }

                        res.on('readable', function ()
                        {
                            expect(this.read()).to.equal(null);
                        });
                    });
                };
            });

            cb(null, mqclient);
        });
    });
},
{
    relay: true
});
