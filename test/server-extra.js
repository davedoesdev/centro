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

    it('should pass back run transport errors (auth config)', function (done)
    {
        var server = new CentroServer(
        {
            transport: {
                server: function (config, authorize, connected, ready, error, warning)
                {
                    ready(new Error('dummy'));
                },
                authorize_config: {}
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

    it('should pass back create transport authorizer errors', function (done)
    {
        var server = new CentroServer(
        {
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

    it('should be able to close immediately (with transport)', function (done)
    {
        this.timeout(5000);

        var server = new CentroServer(
        {
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
            }
        });

        server.on('ready', function ()
        {
            done(new Error('should not be called'));
        });

        server.on('error', done);

        server.close(function (err)
        {
            if (err) { return done(err); }
            setTimeout(done, 2000);
        });
    });

    it('should be able to close immediately (without transport)', function (done)
    {
        this.timeout(5000);

        var server = new CentroServer(
        {
            ANONYMOUS_MODE: true,
            transport: []
        });

        server.on('ready', function ()
        {
            done(new Error('should not be called'));
        });

        server.on('error', done);

        server.close(function (err)
        {
            if (err) { return done(err); }
            setTimeout(done, 2000);
        });
    });


});
