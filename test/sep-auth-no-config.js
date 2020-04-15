/*eslint-env node, mocha */
"use strict";

var centro = require('..'),
    expect = require('chai').expect;

describe('separate auth', function ()
{
    it('should handle no config', function (done)
    {
        centro.separate_auth(function (err)
        {
            expect(err.message).to.equal("Cannot read property 'join' of undefined");
            done();
        });
    });
});
