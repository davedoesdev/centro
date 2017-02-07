/*jshint mocha: true */
"use strict";

var centro = require('..'),
    pipeline = centro.pipeline,
    expect = require('chai').expect,
    EventEmitter = require('events').EventEmitter;

describe('pipeline', function ()
{
    it('should call handlers in turn', function (done)
    {
        var obj = new EventEmitter();

        pipeline(obj, 'foo', function (x, next)
        {
            next(x.concat(1));
        });

        pipeline(obj, 'foo', function (x, next)
        {
            next(x.concat(2));
        });
        
        pipeline(obj, 'foo', function (x, next)
        {
            next(x.concat(3));
        });
 
        pipeline(obj, 'foo', function (x, next)
        {
            expect(x).to.eql([0, 1, 2, 3]);
            next(); // check no error with no default handler
            done();
        });

        obj.emit('foo', [0]);
    });

    it('should still call event handlers', function (done)
    {
        var obj = new EventEmitter(),
            ev1called = false,
            ev2called = false,
            pipelined = false;

        obj.on('foo', function (x)
        {
            expect(ev1called).to.equal(false);
            expect(ev2called).to.equal(false);
            expect(pipelined).to.equal(false);
            expect(x).to.eql([0]);
            ev1called = true;
        });

        pipeline(obj, 'foo', function (x, next)
        {
            expect(ev1called).to.equal(true);
            expect(ev2called).to.equal(false);
            expect(pipelined).to.equal(false);
            expect(x).to.eql([0]);
            next(x.concat(1));
        });

        pipeline(obj, 'foo', function (x, next)
        {
            expect(ev1called).to.equal(true);
            expect(ev2called).to.equal(false);
            expect(pipelined).to.equal(false);
            expect(x).to.eql([0, 1]);
            next(x.concat(2));
        });
        
        pipeline(obj, 'foo', function (x, next)
        {
            expect(ev1called).to.equal(true);
            expect(ev2called).to.equal(false);
            expect(pipelined).to.equal(false);
            expect(x).to.eql([0, 1, 2]);
            next(x.concat(3));
        });
 
        pipeline(obj, 'foo', function (x, next)
        {
            expect(ev1called).to.equal(true);
            expect(ev2called).to.equal(false);
            expect(pipelined).to.equal(false);
            expect(x).to.eql([0, 1, 2, 3]);
            pipelined = true;
        });

        obj.on('foo', function (x)
        {
            expect(ev1called).to.equal(true);
            expect(ev2called).to.equal(false);
            expect(pipelined).to.equal(true);
            expect(x).to.eql([0]);
            ev2called = true;
            done();
        });
 
        obj.emit('foo', [0]);
    });

    it('should call default handlers at end', function (done)
    {
        var obj = new EventEmitter();

        pipeline(obj, 'foo', function (x, next)
        {
            next(x.concat(1));
        });

        pipeline(obj, 'foo', function (x, next)
        {
            next(x.concat(2));
        });
        
        pipeline(obj, 'foo', function (x, next)
        {
            next(x.concat(3));
        });
 
        pipeline(obj, 'foo', function (x, next)
        {
            next(x.concat(4));
        });

        obj.default_foo_handler = function (x)
        {
            expect(arguments.length).to.equal(1);
            expect(x).to.eql([0, 1, 2, 3, 4]);
            done();
        };

        obj.emit('foo', [0]);
    });

    it('should not call default handler if final handler in pipeline does not call next', function (done)
    {
        var obj = new EventEmitter();

        pipeline(obj, 'foo', function (x, next)
        {
            next(x.concat(1));
        });

        pipeline(obj, 'foo', function (x, next)
        {
            next(x.concat(2));
        });
        
        pipeline(obj, 'foo', function (x, next)
        {
            next(x.concat(3));
        });
 
        pipeline(obj, 'foo', function (x, next)
        {
            expect(x).to.eql([0, 1, 2, 3]);
            setTimeout(done, 500);
        });

        obj.default_foo_handler = function (x)
        {
            done(new Error('should not be called'));
        };

        obj.emit('foo', [0]);
    });
});
