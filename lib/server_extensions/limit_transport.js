/**
 * Centro extension for limiting the number of concurrent connections each
 * transport supports.
 *
 * @module centro-js/lib/server_extensions/limit_transport
 */
"use strict";

/**
 * Limit the number of connections each transport supports. Doesn't apply to
 * the {@link centro-js/lib/server_transports/in-mem|in-mem} transport.
 *
 * @param {Object} config - Configuration options.
 * @param {integer} config.max_transport_connections - Maximum number of concurrent connections accepted by each transport.
 */
exports.limit_transport_connections = function (config)
{
    return {
        transport_ready: function (tconfig, ops)
        {
            var cfg = Object.assign({}, config, tconfig);

            if (cfg.max_transport_connections && ops.server)
            {   
                var server = ops.server.server ? ops.server.server : ops.server;
                server.maxConnections = cfg.max_transport_connections;
            }
        }
    };
};
