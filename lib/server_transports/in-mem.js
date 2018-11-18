/*eslint-env node */

/**
 * In-memory transport. This allows messages to be sent over an in-memory stream
 * to a server running in the same process. The in-memory stream has minimal
 * overhead (the messages aren't copied).
 *
 * An extra {@link centro-js/lib/server.CentroServer#transport_ops|transport operation} for this transport is added to the {@link centro-js/lib/server.CentroServer|server object}:
 *
 * <div class="prose transport_ops mb2 h5">
 * <style>.transport_ops table { width: 100%}</style>
 *
 * | Name    | Type |
 * | :------ | :------------------------------------------------------------------------------ |
 * | connect | {@link centro-js/lib/server_transports/in-mem.connectCallback connectCallback} |
 *
 * </div>
 *
 * @module centro-js/lib/server_transports/in-mem
 * @param {Object} config - Configuration options. This supports all the options supported by stream.Duplex as well as the following:
 * @param {Object} [config.in-mem] - If present then this is used in preference to `config`.
 */
"use strict";

var util = require('util'),
    Duplex = require('stream').Duplex;

function RightDuplex(left, options)
{
    Duplex.call(this, options);
    this.left = left;
    this.on('finish', function ()
    {
        left.push(null);
    });
    this._orig_emit = this.emit;
    this.emit = function (type)
    {
        if (type === 'error')
        {
            var args = Array.prototype.slice.call(arguments);
            process.nextTick(function ()
            {
                left._orig_emit.apply(left, args);
            });
        }

        return this._orig_emit.apply(this, arguments);
    };
    this._no_keep_alive = true;
}

util.inherits(RightDuplex, Duplex);

RightDuplex.prototype._read = function ()
{
    if (this._cb)
    {
        var cb = this._cb;
        this._cb = null;
        process.nextTick(cb);
    }
};

RightDuplex.prototype._write = function (chunk, encoding, cb)
{
    if (this.left.push(chunk, encoding))
    {
        process.nextTick(cb);
    }
    else
    {
        this.left._cb = cb;
    }
};

function LeftDuplex(options)
{
    Duplex.call(this, options);
    this.right = new RightDuplex(this, options);
    this.on('finish', function ()
    {
        this.right.push(null);
    });
    this._orig_emit = this.emit;
    this.emit = function (type)
    {
        if (type === 'error')
        {
            var ths = this,
                args = Array.prototype.slice.call(arguments);
            process.nextTick(function ()
            {
                ths.right._orig_emit.apply(ths.right, args);
            });
        }

        return this._orig_emit.apply(this, arguments);
    };
    this._no_keep_alive = true;
}

util.inherits(LeftDuplex, Duplex);

LeftDuplex.prototype._read = function ()
{
    if (this._cb)
    {
        var cb = this._cb;
        this._cb = null;
        process.nextTick(cb);
    }
};

LeftDuplex.prototype._write = function (chunk, encoding, cb)
{
    if (this.right.push(chunk, encoding))
    {
        process.nextTick(cb);
    }
    else
    {
        this.right._cb = cb;
    }
};

module.exports = function (config, authorize, connected, ready, unused_error, unused_warning)
{
    config = config['in-mem'] || config;

    ready(null,
    {
        close: function (cb)
        {
            cb();
        },

        connect: function (cb)
        {
            var left = new LeftDuplex(Object.assign(
            {
                allowHalfOpen: false
            }, config));

            function destroy(mqserver)
            {
                if (!mqserver)
                {
                    left.right.on('readable', function ()
                    {
                        while (this.read() !== null);
                    });

                    while (left.right.read() !== null);
                }

                left.right.end();
            }

            function onclose(cb)
            {
                if (left.right._readableState.ended)
                {
                    return cb();
                }

                left.right.on('end', cb);
            }

            authorize(left.right, destroy, onclose, function (err, handshakes)
            {
                if (err)
                {
                    return left.right.end();
                }

                connected(handshakes, left.right, destroy, onclose);
            });

            cb(null, left);
        }
    });
};

module.exports.LeftDuplex = LeftDuplex;

/*eslint-disable no-unused-vars */

/** Callback type for connecting to in-memory transport.
 *
 * @callback connectCallback
 * @memberof centro-js/lib/server_transports/in-mem
 * @param {?Error} err - Error, if one occurred.
 * @param {stream.Duplex} stream - Stream on which to talk to the server. Use this with {@link centro-js/lib/client.stream_auth|stream_auth}.
 */
/* istanbul ignore next */
exports._connectCallback = function (err, stream) {};

