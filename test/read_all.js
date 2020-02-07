/*eslint-env node */
"use strict";

module.exports = function (s, cb)
{
    var bufs = [], done = false;

    function end()
    {
        if (done) { return; }
        done = true;
        if (cb)
        {
            cb.call(this, Buffer.concat(bufs));
        }
    }
    s.on('end', end);
    //s.on('close', end);

    s.on('readable', function ()
    {
        while (true) //eslint-disable-line no-constant-condition
        {
            var data = this.read();
            if (data === null) { break; }
            bufs.push(data);
        }
    });
};
