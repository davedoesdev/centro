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
    options = options || {};
    this.left = left;
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
    this._orig_destroy = this.destroy;
    this.destroy = function (err, now)
    {
        const destroy = () => {
            left.destroy();
            this._orig_destroy(err);
        };
        if ((options.destroy_wait === undefined) || now)
        {
            return destroy();
        }
        setTimeout(destroy, options.destroy_wait);
    };
    this._no_keep_alive = true;
}

util.inherits(RightDuplex, Duplex);

RightDuplex.prototype._final = function (cb)
{
    this.left.push(null);
    cb();
};

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
        else if (type === 'close')
        {
            this.right.destroy(undefined, true);
        }

        return this._orig_emit.apply(this, arguments);
    };
    this._no_keep_alive = true;
}

util.inherits(LeftDuplex, Duplex);

LeftDuplex.prototype._final = function (cb)
{
    this.right.push(null);
    cb();
};

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

module.exports = function (config, authorize, connected, ready, unused_error, warning)
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
                allowHalfOpen: false,
                autoDestroy: true,
                destroy_wait: 1000
            }, config));

            left.right.on('end', function ()
            {
                try
                {
                    this.destroy();
                }
                catch (ex)
                {
                    /* istanbul ignore next */
                    warning(ex);
                }
            });

            function destroy(mqserver, now)
            {
                left.right.destroy(undefined, now);
            }

            function onclose(cb)
            {
                if (left.right.destroyed)
                {
                    return cb();
                }

                left.right.on('close', cb);
            }

            authorize(left.right, now => destroy(null, now), onclose, function (err, handshakes)
            {
                if (err)
                {
                    return left.right.destroy();
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

