/**
 * HTTP transport. This allows messages to be sent using HTTP POST requests
 * and received using HTTP Server-Sent Events. See the {@link http://rawgit.davedoesdev.com/davedoesdev/centro/master/rest_docs|REST documentation}
 * for more details.
 *
 * @module centro-js/lib/server_transports/http
 * @param {Object} config - Configuration options. This supports all the options supported by {@link https://nodejs.org/api/net.html#net_server_listen_options_callback|net.Server#listen}, {@link https://nodejs.org/api/https.html#https_https_createserver_options_requestlistener|https.createServer} and {@link https://github.com/primus/access-control|access-control} as well as the following:
 * @param {http.Server|https.Server} [config.server] - If you want to supply your own HTTP or HTTPS server object. Otherwise, {@link https://nodejs.org/api/http.html#http_http_createserver_requestlistener|http.createServer} or {@link https://nodejs.org/api/https.html#https_https_createserver_options_requestlistener|https.createServer} will be called to create one.
 * @param {string} [config.pathname=/centro/v1/] - Pathname prefix on which to listen for requests. Publish requests are made on `/centro/v1/publish` and subscribe requests are made on `/centro/v1/subscribe`.
 * @param {integer} [config.sse_keep_alive_interval] - If present, the number of seconds between sending a Server-Sent Event comment in order to keep a connection alive. If you don't specify this, no keep-alive comments will be sent.
 * @param {Object} [config.http] - If present then this is used in preference to `config`.
 */
"use strict";

var http = require('http'),
    https = require('https'),
    async = require('async'),
    Duplex = require('stream').Duplex,
    LeftDuplex = require('./in-mem').LeftDuplex,
    Transform = require('stream').Transform,
    centro = require('../..'),
    Ajv = require('ajv'),
    ajv = new Ajv(),
    access = require('access-control');

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
        sub_pathname = pathname + 'subscribe',
        cors = access(Object.assign(
        {
            methods: ['GET', 'POST', 'OPTIONS']
        }, config.access));

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
            left,
            sse_interval;

        function done(code, data, err, headers, only_headers)
        {
            warning(err);

            if (sse_interval !== undefined)
            {
                clearInterval(sse_interval);
                sse_interval = undefined;
            }

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

        if (cors(req, res))
        {
            return;
        }

        req.on('error', warning);
        res.on('error', warning);

        function onclose()
        {
            closed = true;
        }
        res.on('prefinish', onclose);
        res.on('close', onclose);

        var url = require('url').parse(req.url, true);

        if ((url.pathname !== pub_pathname) &&
            (url.pathname !== sub_pathname))
        {
            return done(404, 'not found');
        }

        if (((url.pathname === pub_pathname) && (req.method !== 'POST')) ||
            ((url.pathname === sub_pathname) && (req.method !== 'GET')))
        {
            return done(405, 'method not allowed');
        }

        authorize(req, function ()
        {
            done(503, 'closed');
        }, function (cb)
        {
            if (req.socket.destroyed)
            {
                return cb();
            }
            req.socket.on('close', cb);
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

            mqclient.on('error', function (err, obj)
            {
                if (obj instanceof Duplex)
                {
                    return warning(err);
                }
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
                                     data: chunk.toString('binary')
                                 }) + '\n\n');
                    };

                    s.on('error', function (err)
                    {
                        res.write('event: peer_error\ndata: ' +
                                  JSON.stringify(
                                  {
                                      id: msgid
                                  }) + '\n\n');
                    });

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
                        res.setTimeout(0);
                        res.on('prefinish', done);
                        res.on('close', done);
                        res.write(':ok\n\n');

                        if (config.sse_keep_alive_interval)
                        {
                            sse_interval = setInterval(function ()
                            {
                                res.write(':ka\n\n');
                            }, config.sse_keep_alive_interval * 1000);
                        }
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

            server: server,
            pub_pathname: pub_pathname,
            sub_pathname: sub_pathname
        });
    }

    if (config.server)
    {
        return listening();
    }

    server.listen(config, listening);
};
