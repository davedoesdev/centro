/*jshint mocha: true */
"use strict";

var centro = require('..'),
    CentroServer = centro.CentroServer,
    expect = require('chai').expect,
    stream = require('stream');

describe('connect after close', function ()
{
    it('should destroy connections made after server is closed', function (done)
    {
        var server = new CentroServer(
        {
            authorize: require('authorize-jwt'),
            ANONYMOUS_MODE: true,
            transport: function (config, authorize, connected, ready, error, warning)
            {
                ready(null,
                {
                    close: function (cb)
                    {
                        cb();
                    }
                });

                process.nextTick(function ()
                {
                    server.close(function ()
                    {
                        connected(null, new stream.PassThrough(), done);
                    });
                });
            }
        });
    });
});
