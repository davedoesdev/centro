var http = require('http'),
    LeftDuplex = require('./in-mem').LeftDuplex,
    centro = require('../..');

module.exports = function (config, authorize, connected, ready, error, warning)
{
    config = config.http || config;

    var server = config.server || http.createServer();

    server.on('request', function (req, res)
    {
        var left;

        function done(code, data, err, headers)
        {
            code = code || 500;
            data = typeof data === 'string' ? data :
                   (data || 'server error');

            if (err)
            {
                warning(err);
            }

            try
            {
                if (left)
                {
                    left.end();
                }

                try
                {
                    res.writeHead(code, headers);
                }
                finally
                {
                    res.end(data);
                }
            }
            catch (ex)
            {
                warning(ex);
            }
        }

        var url = require('url').parse(req.url, true);

        if (url.pathname !== '/publish')
        {
            return done(404, 'not found');
        }

        authorize(req, function (err, handshakes)
        {
            if (err)
            {
                var code = err.statusCode || 401;

                return done(code,
                            err.message || err,
                            null,
                            (code === 401) && err.authenticate ?
                            {
                                'WWW-Authenticate': err.authenticate
                            } : undefined);
            }

            left = new LeftDuplex(Object.assign(
            {
                allowHalfOpen: false
            }, config));

            connected(handshakes,
                      left.right,
                      function ()
                      {
                          left.right.end();
                          done(503, 'closed');
                      },
                      function (cb)
                      {
                          left.right.on('end', cb);
                      });

            var mqclient = centro.start(left, config);

            mqclient.on('error', function (err)
            {
                done(null, null, err);
            });

            mqclient.on('ready', function ()
            {
                try
                {
                    var options = {
                        single: url.query.single === 'true'
                    };

                    if (url.query.ttl)
                    {
                        options.ttl = parseInt(url.query.ttl);
                    }

                    var n = 0;

                    if (url.query.n !== undefined)
                    {
                        n = parseInt(url.query.n);
                    }

                    req.pipe(this.publish(n, url.query.topic, options,
                    function (err)
                    {
                        if (err)
                        {
                            return done(null, null, err);
                        }

                        done(200, '');
                    }));
                }
                catch (ex)
                {
                    done(null, null, ex);
                }
            });
        });
    });

    server.on('error', error);

    function listening()
    {
        ready(null,
        {
            close: function (cb)
            {
                if (server.listening === false)
                {
                    cb();
                }
                else
                {
                    server.close(cb);
                }
            }
        });
    }

    if (config.server)
    {
        if (server.listening === false)
        {
            server.once('listening', listening);
        }
        else
        {
            listening();
        }
    }
    else
    {
        server.listen(config, listening);
    }
};
