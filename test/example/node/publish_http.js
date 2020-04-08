/*eslint-env node */
"use strict";

process.stdin.pipe(require('http').request({ // <1>
    method: 'POST',
    hostname: 'localhost',
    port: 8802,
    path: '/centro/v2/publish?' + require('querystring').stringify({
        authz_token: process.env.CENTRO_TOKEN,
        topic: process.argv[2]
    })
}));
