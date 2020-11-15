/*eslint-env node */

/**
 * Centro extensions for filtering messages.
 *
 * @module centro-js/lib/server_extensions/filter
 */
"use strict";

/**
 * Postpone sending a message until all existing message streams
 * to the message's recipients are under their high-water mark.
 *
 * @param {Object} config - Configuration options.
 * @param {centro-js/lib/server_extensions/filter.delayCallback} [config.on_delay] - Called when a message is postponed.
 */
exports.delay_message_until_all_streams_under_hwm = function (config)
{
    config = config || /* istanbul ignore next */ {};

    return {
        ready: function ()
        {
            this.fsq.filters.push(function (info, handlers, cb)
            {
                for (var h of handlers)
                {
                    if (h.mqlobber_server)
                    {
                        for (var d of h.mqlobber_server.mux.duplexes.values())
                        {
                            if (d._writableState.length >= d._writableState.highWaterMark)
                            {
                                /* istanbul ignore else */
                                if (config.on_delay)
                                {
                                    config.on_delay(info, handlers, h, d);
                                }

                                return cb(null, false);
                            }
                        }
                    }
                }

                cb(null, true, handlers);
            });
        }
    };
};

var FastestWritable = require('fastest-writable').FastestWritable,
    fw_prop = 'centro_server_extension_filter_fastest_writable';

/**
 * Send messages at the rate that the fastest client connection can handle.
 * Normally, messages are sent at the rate of the slowest client.
 * 
 * You should {@link centro-js/lib/server.CentroServer#attach_extension|attach}
 * this extension last but before {@link centro-js/lib/server_extensions/filter.dummy_data_event|dummy_data_event}.
 *
 * @param {Object} [config] - Configuration option. This is passed to {@link https://github.com/davedoesdev/fastest-writable#fastestwritableoptions|FastestWritable} and also supports the following options:
 * @param {centro-js/lib/server_extensions/filter.fastestWritableCallback} [config.on_fw] - Called with the {@link https://github.com/davedoesdev/fastest-writable#fastestwritableoptions|FastestWritable} object constructed for each message stream.
 */
exports.fastest_writable = function (config)
{
    config = config || /* istanbul ignore next */ {};

    return {
        pre_connect: function (info)
        {
            this.pipeline(info.mqserver, 'message', function (stream, info, multiplex, cb, next)
            {
                var fw = stream[fw_prop];

                if (!fw)
                {
                    stream[fw_prop] = new FastestWritable(config);

                    /* istanbul ignore else */
                    if (config.on_fw)
                    {
                        config.on_fw(stream[fw_prop], this, stream, info);
                    }
                }

                var duplex = multiplex(config.on_error);

                stream[fw_prop].add_peer(duplex);

                if (!fw)
                {
                    next(stream, info, function ()
                    {
                        return stream[fw_prop];
                    }, cb);
                }
            });
        }
    };
};

/**
 * Emit an empty `data` event on a message stream after it's piped to a client
 * connection. This enables the message stream immediately to determine when a
 * connection is at full capacity. Otherwise, the message stream must read
 * initial message data and write it to the connection in order to make this
 * determination.
 *
 * Node 15.2.0 onwards properly checks the destination stream before starting
 * to pipe data, so this function becomes a no-op.
 *
 * You should {@link centro-js/lib/server.CentroServer#attach_extension|attach}
 * this extension last.
 */
exports.dummy_data_event = function ()
{
    return {
        pre_connect: function (info)
        {
            this.pipeline(info.mqserver, 'message', function (stream, info, multiplex, cb, next)
            {
                next(stream, info, function ()
                {
                    var duplex = multiplex.apply(this, arguments);

                    /* istanbul ignore if */
                    if (duplex.writableNeedDrain === undefined)
                    {
                        duplex.on('pipe', function (src)
                        {
                            const orig_pause = src.pause;
                            src.pause = function ()
                            {
                                orig_pause.call(this);
                                // pause() was called so dest is full
                                // pipe() calls resume() after event handler
                                // returns so we want to stop src resuming
                                const orig_resume = this.resume;
                                this.resume = function ()
                                {
                                    this.resume = orig_resume;
                                };
                            };
                            src.emit('data', '');
                            src.pause = orig_pause;
                        });
                    }

                    return duplex;
                }, cb);
            });
        }
    };
};

/*eslint-disable no-unused-vars */

/**
 * Callback type for postponing a message.
 *
 * @callback delayCallback
 * @memberof centro-js/lib/server_extensions/filter
 * @param {Object} info - Metadata for the message. See {@link https://github.com/davedoesdev/mqlobber#mqlobberservereventsmessagestream-info-multiplex-done|MQlobber.events.message} for details.
 */
/* istanbul ignore next */
exports._delayCallback = function (info) {};

/**
 * Callback type for creation of a {@link https://github.com/davedoesdev/fastest-writable#fastestwritableoptions|FastestWritable} for a message stream.
 *
 * @callback fastestWritableCallback
 * @memberof centro-js/lib/server_extensions/filter
 * @param {FastestWritable} fw - `FastestWritable` that was created for the message stream.
 * @param {MQlobberServer} mqserver - {@link https://github.com/davedoesdev/mqlobber#mqlobberserverfsq-stream-options|MQlobberServer} object for this client connection.
 * @param {stream.Readable} stream - Message stream.
 * @param {Object} info - Metadata for the message. See {@link https://github.com/davedoesdev/mqlobber#mqlobberservereventsmessagestream-info-multiplex-done|MQlobber.events.message} for details.
 */
/* istanbul ignore next */
exports._fastestWritableCallback = function (fw, mqserver, stream, info) {};
