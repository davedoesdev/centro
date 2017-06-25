/**
 * HTTP transport. This allows messages to be published using HTTP POST requests
 * and received using HTTP Server-Sent Events.
 *
 * Publish messages using POST requests of the form:
 *
 * ```
 * /centro/v1/publish?authz_token=XXX&topic=YYY
 * ```
 *
 * - `XXX` is a {@link http://self-issued.info/docs/draft-ietf-oauth-json-web-token.html|JSON Web Token} allowing access to the server. See {@link https://github.com/davedoesdev/centro#authz-tokens|here} for more information about Centro authorization tokens.
 * - `YYY` is the message's topic. Topics should be in AMQP format: `.` delimits words.
 * - The request body should contain the message's data. The server doesn't
 *   interpret the data, it just treats it as a binary stream.
 *
 * Subscribe to messages using GET requests of the form:
 *
 * ```
 * /centro/v1/subscribe?authz_token=XXX&topic=YYY&topic=ZZZ
 * ```
 *
 * - `XXX` is the authorization token allowing access to the server.
 * - `YYY` is the message topic to which to subscribe. Topics should be in AMQP format: `.` delimits words, `*` matches exactly one word and `#` matches zero or more words.
 * - You can specify more than one topic, e.g. `ZZZ` above.
 * 
 * Messages you've subscribed to are delivered using server-sent events. Each
 * message begins with a `start` event, continues with multiple `data` events
 * and finishes with an `end` event.
 *
 * For example, consider a message with topic `foo.bar` and body `wow`. You
 * could receive the following events:
 *
 * ```
 * type: start
 * data: {"id":0,"single":false,"existing":false,"expires":1498375188,"size":3,"topic":"foo.bar"}
 *
 * type: data
 * data: {"id":0,"data":"wow"}
 *
 * type: end
 * data: {"id":0}
 * ```
 *
 * For larger messages you may receive multiple `data` messages. The event
 * data for each event is JSON-encoded and always contains a message `id`
 * (in this case `0`). If you're receiving multiple messages at the same time,
 * their events may be interleaved so you need to use the `id` to tell which
 * event is for which message. The `id` identifies the message for this
 * connection only - it isn't globally unique and the same message may have a
 * different `id`s on different connections.
 *
 * In the `start` event, you'll receive whether the messages is being delivered
 * to a `single` subscriber, whether it's an `existing` message (i.e. published
 * before we subscribed), when it `expires` (in seconds since 1970-01-01),
 * the `size` of its body data and its `topic`.
 *
 * In the `data` event, you'll receive (part of) the message's body (`wow` in
 * this case). Since this is JSON-encoded, the data will be a UTF-8 encoded
 * string, even for binary data. If you need to get the raw binary data,
 * encode the string as latin-1 and use the bytes in the result (the server
 * decodes the bytes as latin-1 before JSON encoding the result).
 *
 * Note that server-sent _event IDs_ and the `Last-Event-ID` header are not
 * supported because when a connection drops, the server forgets all about it.
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
