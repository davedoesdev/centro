"use strict";

exports.close_conn_on_error = function ()
{
    return {
        authz_start: function (cancel, onclose, obj)
        {
            obj.on('error', cancel);
        },

        pre_connect: function (info)
        {
            info.mqserver.on('error', function ()
            {
                info.destroy();
            });
        }
    };
};
