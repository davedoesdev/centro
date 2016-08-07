var net = require('net'),
    frame = require('frame-stream');

module.exports = function (config, authorize)
{
    var server = net.createServer(config, function (conn)
    {
        var in_stream = frame.decode(config);

        function done(v)
        {
            if (v)
            {
                throw v;
            }
        }

        conn.on('readable', function onread()
        {
            while (true)
            {
                var data = this.read();

                if (data === null)
                {
                    break;
                }

                var buffer = in_stream.buffer;

                try
                {
                    in_stream.push = done;
                    in_stream._transform(data, null, done);
                }
                catch (v)
                {
                    conn.removeListener('readable', onread);

                    if (v instanceof Buffer)
                    {
                        var rest = buffer ? Buffer.concat([buffer, data]) : data;
                        conn.unshift(rest.slice(in_stream.opts.lengthSize + v.length));

                        authorize(v,
                        {
                            close: function ()
                            {
                                conn.destroy();
                            },

                            on_stream: function (cb)
                            {
                                cb(conn);
                            }
                        });
                        
                        
                        
                        
                        function (err)
                        {
                            if (err)
                            {
                                console.warn(err);
                            }

                            connected(
                            {
                                stream: conn
                                // will need to add e.g. close function
                            }
                        });
                    }

                    console.warn(v);
                    conn.destroy();
                }
            }
        });

        // so how do we indicate the connection should be closed?
        // have to pass in dict with conn, token and unauthorized,
        // timeout fns etc
    });
    
    server.listen(config);
};
