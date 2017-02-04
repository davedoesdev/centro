"use strict";

exports.limit_transport_connections = function (config)
{
    var servers = new Set();

    return {
        transport_ready: function (tconfig, ops)
        {
            var cfg = Object.assign({}, config, tconfig);

            if (cfg.max_transport_connections && ops.server)
            {   
                var server = ops.server.server ? ops.server.server : ops.server;
                server.maxConnections = cfg.max_transport_connections;
                servers.add(server);
            }
        }
    };
};
