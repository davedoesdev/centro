process.stdin.pipe(require('http').request(
{
    method: 'POST',
    hostname: 'localhost',
    port: 8802,
    path: '/centro/v1/publish?' + require('querystring').stringify(
    {
        authz_token: process.env.CENTRO_TOKEN,
        topic: process.argv[2]
    })
}));
