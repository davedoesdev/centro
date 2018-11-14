/*eslint-env node, mocha */
"use strict";

var centro = require('..'),
    read_frame = centro.read_frame,
    expect = require('chai').expect,
    PassThrough = require('stream').PassThrough;

describe('read_frame errors', function ()
{
    it('should handle immediate eos', function (cb)
    {
        var s = new PassThrough();

        read_frame({}, s, function (err)
        {
            expect(err.message).to.equal('ended before frame');
            cb();
        });

        s.end();
    });

    it('should handle fragmented data', function (cb)
    {
        var s = new PassThrough();

        read_frame({}, s, function (err, v)
        {
            expect(err).to.equal(null);
            expect(v.toString()).to.equal('X');
            cb();
        });

        var buf = new Buffer(4);
        buf.writeInt32BE(1, 0);
        s.write(buf);
        s.end('X');
    });

    it('should handle transform errors', function (cb)
    {
        var s = new PassThrough();

        read_frame({ maxSize: 1 }, s, function (err)
        {
            expect(err.message).to.equal('Message is larger than the allowed maximum of 1');
            cb();
        });

        var buf = new Buffer(4);
        buf.writeInt32BE(2, 0);
        s.write(buf);
        s.end('XX');
    });
});
