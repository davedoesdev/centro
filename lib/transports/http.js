var http = require('http'),
    https = require('https'),
    LeftDuplex = require('./in-mem').LeftDuplex,
    centro = require('../..');

module.exports = function (config, authorize, connected, ready, error, warning)
{
    config = config.http || config;

    var certs = config.key && config.cert,
        port = config.port || 443,
        secure = certs || port === 443,
        server = config.server ||
                 (secure ? https.createServer(config) : http.createServer()),
        pathname = config.pathname || ('/centro/v' + centro.version + '/publish');

    function request(req, res)
    {
        var left;

        function done(code, data, err, headers)
        {
            code = code || 500;
            data = typeof data === 'string' ? data : 'server error';

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

        if (url.pathname !== pathname)
        {
            return done(404, 'not found');
        }

        res.on('error', warning);

        authorize(req, function ()
        {
            done(503, 'closed');
        }, function (err, handshakes, tokens)
        {
            if (err)
            {
                return done(err.statusCode,
                            err.message,
                            null,
                            {
                                'WWW-Authenticate': err.authenticate
                            });
            }

            left = new LeftDuplex(Object.assign(
            {
                allowHalfOpen: false
            }, config));

            req.on('error', function (err)
            {
                left.emit('error', err);
            });

            connected(handshakes,
                      left.right,
                      function (mqserver)
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
                          done(503, 'closed');
                      },
                      function (cb)
                      {
                          if (left.right._readableState.ended)
                          {
                              return cb();
                          }
                          left.right.on('end', cb);
                      });

            var mqclient = centro.start(left, Object.assign(
            {
                token: tokens
            }, config));

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

                    if (url.query.ttl !== undefined)
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
    }

    server.on('request', request);
    server.on('error', error);

    function listening()
    {
        ready(null,
        {
            close: function (cb)
            {
                server.removeListener('request', request);
                server.removeListener('error', error);

                if (config.server)
                {
                    return cb();
                }

                server.close(cb);
            },

            address: server.address()
        });
    }

    if (config.server)
    {
        return listening();
    }

    server.listen(config, listening);
};
