module.exports = function (s, cb)
{
    var bufs = [], done = false;

    function end()
    {
        if (done) { return; }
        done = true;
        if (cb)
        {
            cb(Buffer.concat(bufs));
        }
    }
    s.on('end', end);
    s.on('close', end);

    s.on('readable', function ()
    {
        while (true)
        {
            var data = this.read();
            if (data === null) { break; }
            bufs.push(data);
        }
    });
};
