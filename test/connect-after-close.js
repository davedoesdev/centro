/*eslint-env node, mocha */
"use strict";

var centro = require('..'),
    CentroServer = centro.CentroServer,
    stream = require('stream');

describe('connect after close', function ()
{
    it('should destroy connections made after server is closed', function (done)
    {
        var server = new CentroServer(
        {
            transport: function (config, authorize, connected, ready, unused_error, unused_warning)
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
