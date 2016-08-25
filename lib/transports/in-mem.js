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
}

util.inherits(RightDuplex, Duplex);

RightDuplex.prototype._read = function ()
{
    if (this._cb)
    {
        var cb = this.cb;
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
    }.bind(this));
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

module.exports = function (config, authorize, connected, ready, error)
{
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

            authorize(left.right, function (err, handshakes)
            {
                if (err)
                {
                    return;
                }

                connected(handshakes,
                          left.right,
                          function ()
                          {
                              left.right.end();
                          },
                          function (cb)
                          {
                              left.right.on('end', cb);
                          });
            });

            cb(null, left);
        }
    });
}
