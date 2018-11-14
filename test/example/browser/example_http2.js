/*eslint-env browser */
/*eslint-disable no-unused-vars, no-undef, no-console */

var publish = function (event)
{
    "use strict";
    event.preventDefault();
};

function connect()
{
    "use strict";

    var topic = document.getElementById('topic'),
        message = document.getElementById('message'),
        messages = document.getElementById('messages'),
        params = new URLSearchParams(window.location.search);

    function tag_text(cls, text)
    {
        var div = document.createElement('div');
        div.className = cls;
        div.appendChild(document.createTextNode(text));
        return div;
    }

    function add_message(div)
    {
        messages.appendChild(div);
        messages.scrollTop = messages.scrollHeight;
    } 

    centro.separate_auth(
    {
        token: params.get('token')
    }, async function (err, userpass, make_client)
    {
        if (err) { throw(err); }

        var duplex = await centro.make_client_http2_duplex(
            'https://localhost:8804/centro/v2/http2-duplex', {
                headers: {
                    Authorization: 'Bearer ' + userpass.split(':')[1]
                }
            }),
            client = make_client(duplex);

        client.on('ready', function ()
        {
            add_message(tag_text('status', 'open'));
            this.subscribe(params.get('subscribe'), function (s, info)
            {
                centro.read_all(s, function (v)
                {
                    var msg = document.createElement('div');
                    msg.className = 'message';
                    msg.appendChild(tag_text('topic', info.topic));
                    msg.appendChild(tag_text('data', v.toString()));
                    add_message(msg);
                });
            });

            publish = function (event)
            {
                event.preventDefault();
                client.publish(topic.value).end(message.value);
            };
        });

        duplex.on('end', function ()
        {
            add_message(tag_text('status', 'closed'));
        });

        client.on('error', function (err)
        {
            console.error(err);
            duplex.destroy();
        });
    });
}
