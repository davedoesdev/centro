var centro = require('centro-js'),
    net = require('net'),
    assert = require('assert');

function display_message(s, info)
{
    console.log('topic:', info.topic);
    s.pipe(process.stdout);
}

net.createConnection(8800, function ()
{
    centro.stream_auth(this,
    {
        token: process.env.CENTRO_TOKEN
    }).on('ready', function ()
    {
        for (var topic of process.argv.slice(2))
        {
            this.subscribe(topic, display_message, assert.ifError);
        }
    });
});
