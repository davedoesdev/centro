var EventSource = require('eventsource'),
    es = new EventSource('http://localhost:8802/centro/v1/subscribe?' +
                         require('querystring').stringify(
                         {
                             authz_token: process.env.CENTRO_TOKEN,
                             topic: process.argv[2]
                         }));

es.addEventListener('start', function (e)
{
    console.log('topic:', JSON.parse(e.data).topic);
});

es.addEventListener('data', function (e)
{
    process.stdout.write(JSON.parse(e.data).data, 'binary');
});

