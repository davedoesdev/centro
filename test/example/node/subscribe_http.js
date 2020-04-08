/*eslint-env node */
/*eslint-disable no-console */
"use strict";

const EventSource = require('eventsource'); // <1>
const es = new EventSource('http://localhost:8802/centro/v2/subscribe?' +
                           require('querystring').stringify({
                               authz_token: process.env.CENTRO_TOKEN,
                               topic: process.argv.slice(2)
                           }));

es.addEventListener('start', function (e) {
    const data = JSON.parse(e.data);
    console.log('id:', data.id, 'topic:', data.topic);
});

es.addEventListener('data', function (e) {
    process.stdout.write(JSON.parse(e.data).data, 'binary');
});
