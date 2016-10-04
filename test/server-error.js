/*jshint mocha: true */
"use strict";

var centro = require('..'),
    CentroServer = centro.CentroServer,
    expect = require('chai').expect;

describe('server errors', function ()
{
    it('should pass back run transport errors', function (done)
    {
        var server = new CentroServer(
        {
            authorize: require('authorize-jwt'),
            ANONYMOUS_MODE: true,
            transport: function (config, authorize, connected, ready, error, warning)
            {
                ready(new Error('dummy'));
            }
        });

        server.on('error', function (err)
        {
            expect(err.message).to.equal('dummy');
            done();
        });
    });

    it('should pass back create authorizer errors', function (done)
    {
        var server = new CentroServer(
        {
            authorize: function (config, cb)
            {
                cb(new Error('dummy'));
            }
        });

        server.on('error', function (err)
        {
            expect(err.message).to.equal('dummy');
            done();
        });
    });

    it('should pass back create transport authorizer errors', function (done)
    {
        var server = new CentroServer(
        {
            authorize: require('authorize-jwt'),
            ANONYMOUS_MODE: true,
            transport: {
                authorize_config: {
                    authorize: function (config, cb)
                    {
                        cb(new Error('dummy'));
                    }
                }
            }
        });

        server.on('error', function (err)
        {
            expect(err.message).to.equal('dummy');
            done();
        });
    });
});
