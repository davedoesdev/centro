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
            left._orig_emit.apply(left, arguments);
        }

        return this._orig_emit.apply(this, arguments);
    };
}

util.inherits(RightDuplex, Duplex);

RightDuplex.prototype._read = function ()
{
    if (this._cb)
    {
        var cb = this._cb;
        this._cb = null;
        cb();
    }
};

RightDuplex.prototype._write = function (chunk, encoding, cb)
{
    if (this.left.push(chunk, encoding))
    {
        cb();
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
            this.right._orig_emit.apply(this.right, arguments);
        }

        return this._orig_emit.apply(this, arguments);
    };
}

util.inherits(LeftDuplex, Duplex);

LeftDuplex.prototype._read = function ()
{
    if (this._cb)
    {
        var cb = this._cb;
        this._cb = null;
        cb();
    }
};

LeftDuplex.prototype._write = function (chunk, encoding, cb)
{
    if (this.right.push(chunk, encoding))
    {
        cb();
    }
    else
    {
        this.right._cb = cb;
    }
};

module.exports = function (config, authorize, connected, ready, error, warning)
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
