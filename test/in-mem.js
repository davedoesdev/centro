/*eslint-env node, mocha */
"use strict";

var runner = require('./runner'),
    centro = require('..'),
    in_mem = require('../lib/server_transports/in-mem.js'),
    crypto = require('crypto'),
    read_all = require('./read_all'),
    expect = require('chai').expect;

runner(
{
    transport: 'in-mem'
}, function (config, server, cb)
{
    server.transport_ops[0].connect(function (err, stream)
    {
        if (err)
        {
            return cb(err);
        }

        cb(null, centro.stream_auth(stream, config));
    });
},
{
    extra: function ()
    {
        it('should support backpressure on in-memory stream', function (done)
        {
            var left = new in_mem.LeftDuplex(),
                buf = crypto.randomBytes(65 * 1024 * 1024);

            expect(left.write(buf)).to.equal(false);
            left.end();

            read_all(left.right, function (v)
            {
                expect(v.equals(buf)).to.equal(true);

                buf = crypto.randomBytes(65 * 1024 * 1024);

                expect(left.right.write(buf)).to.equal(false);
                left.right.end();

                read_all(left, function (v)
                {
                    expect(v.equals(buf)).to.equal(true);

                    done();
                });
            });
        });

        it('should relay error events', function (done)
        {
            var left = new in_mem.LeftDuplex(),
                errors = [];

            left.on('error', function (err)
            {
                errors.push('left', err.message);
            });

            left.right.on('error', function (err)
            {
                errors.push('right', err.message);
            });

            left.emit('error', new Error('dummy'));
            left.right.emit('error', new Error('dummy2'));

            process.nextTick(function ()
            {
                expect(errors).to.eql(['left', 'dummy',
                                       'right', 'dummy2',
                                       'right', 'dummy',
                                       'left', 'dummy2']);
                done();
            });
        });
    }
});
