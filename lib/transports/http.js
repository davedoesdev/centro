var http = require('http'),
    https = require('https'),
    async = require('async'),
    LeftDuplex = require('./in-mem').LeftDuplex,
    Transform = require('stream').Transform,
    centro = require('../..'),
    Ajv = require('ajv'),
    ajv = new Ajv();

module.exports = function (config, authorize, connected, ready, error, warning)
{
    config = config.http || config;

    var certs = config.key && config.cert,
        port = config.port || /* istanbul ignore next */ 443,
        secure = certs || port === 443,
        server = config.server ||
                 (secure ? https.createServer(config) : http.createServer()),
        pathname = config.pathname || ('/centro/v' + centro.version + '/'),
        pub_pathname = pathname + 'publish',
        sub_pathname = pathname + 'subscribe';

    var validate_pub = ajv.compile({
        type: 'object',
        required: ['topic'],
        properties: {
            topic: {
                type: 'string',
                maxLength: config.max_topic_length
            },
            n: {
                type: 'integer'
            },
            single: {
                type: 'boolean'
            },
            ttl: {
                type: 'integer'
            }
        }
    });

    var validate_sub = ajv.compile({
        type: 'object',
        required: ['topics'],
        properties: {
            topics: {
                type: ['array'],
                minItems: 1,
                maxItems: config.max_subscribe_topics,
                items: {
                    type: 'string',
                    maxLength: config.max_topic_length
                }
            },
            ns: {
                type: ['array'],
                maxItems: config.max_subscribe_topics,
                items: {
                    type: 'integer',
                }
            }
        }
    });

    function request(req, res)
    {
        var closed = false,
            headers_written = false,
            left;

        function done(code, data, err, headers, only_headers)
        {
            warning(err);

            try
            {
                if (left && (closed || !only_headers))
                {
                    process.nextTick(function ()
                    {
                        left.end();
                    });
                }

                if (closed)
                {
                    return false;
                }

                if (headers_written)
                {
                    res.end();
                    closed = true;
                    return false;
                }

                code = code || 500;
                data = typeof data === 'string' ? data : 'server error';

                try
                {
                    res.writeHead(code, headers);
                    headers_written = true;
                }
                catch (ex)
                {
                    warning(ex);
                    res.end(data);
                    closed = true;
                    return false;
                }

                if (!only_headers)
                {
                    res.end(data);
                    closed = true;
                }

                return true;
            }
            catch (ex)
            {
                warning(ex);
                return false;
            }
        }

        req.on('error', warning);
        res.on('error', warning);
        res.on('close', function ()
        {
            closed = true;
        });

        var url = require('url').parse(req.url, true);

        if ((url.pathname !== pub_pathname) &&
            (url.pathname !== sub_pathname))
        {
            return done(404, 'not found');
        }

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

            left.on('end', function ()
            {
                done(503, 'closed');
            });

            function error(err)
            {
                left.emit('error', err);
            }
            req.on('error', error);
            res.on('error', error);

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
                var options, txt;

                if (url.pathname === pub_pathname)
                {
                    options = {
                        topic: url.query.topic,
                        n: 0,
                        single: url.query.single === 'true',
                    };

                    if (url.query.n !== undefined)
                    {
                        options.n = parseInt(url.query.n);
                    }

                    if (url.query.ttl !== undefined)
                    {
                        options.ttl = parseInt(url.query.ttl);
                    }

                    if (!validate_pub(options))
                    {
                        txt = ajv.errorsText(validate_pub.errors);
                        return done(400, txt, new Error(txt));
                    }

                    return req.pipe(this.publish(options.n, options.topic, options,
                    function (err)
                    {
                        if (err)
                        {
                            return done(null, null, err);
                        }

                        done(200, '');
                    }));
                }

                var last_msgid = 0;

                function handler(s, info, cb)
                {
                    var msgid = last_msgid++,
                        t = new Transform();

                    res.write('event: start\ndata: ' +
                              JSON.stringify(Object.assign(
                              {
                                  id: msgid
                              }, info)) + '\n\n');
                              
                    t.on('end', function ()
                    {
                        res.write('event: end\ndata: ' +
                                  JSON.stringify(
                                  {
                                      id: msgid
                                  }) + '\n\n');
                        cb();
                    });

                    t._transform = function (chunk, encoding, cb)
                    {
                        cb(null, 'event: data\ndata: ' +
                                 JSON.stringify(
                                 {
                                     id: msgid,
                                     data: chunk.toString('base64')
                                 }) + '\n\n');
                    };

                    s.pipe(t).pipe(res, { end: false });
                }

                options = {
                    topics: url.query.topic,
                    ns: []
                };

                if (typeof options.topics === 'string')
                {
                    options.topics = [options.topics];
                }

                if (typeof url.query.n === 'string')
                {
                    options.ns = [url.query.n];
                }
                else if (url.query.n !== undefined)
                {
                    options.ns = url.query.n;
                }

                options.ns = options.ns.map(function (n)
                {
                    return parseInt(n);
                });

                if (!validate_sub(options))
                {
                    txt = ajv.errorsText(validate_sub.errors);
                    return done(400, txt, new Error(txt));
                }

                async.timesSeries(options.topics.length, async.ensureAsync(function (i, next)
                {
                    mqclient.subscribe(options.ns[i] || 0,
                                       options.topics[i],
                                       handler,
                                       next);
                }), function (err)
                {
                    if (err)
                    {
                        return done(null, null, err);
                    }

                    if (done(200, '', null,
                    {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive'
                    }, true))
                    {
                        res.on('close', done);
                        res.write(':ok\n\n');
                    }
                });
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
                          req.destroy();
                          res.destroy();
                      },
                      function (cb)
                      {
                          if (left.right._readableState.ended)
                          {
                              return cb();
                          }
                          left.right.on('end', cb);
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
