var publish = function (event) { event.preventDefault(); };

function connect()
{
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
    }, function (err, userpass, make_client)
    {
        if (err) { throw(err); }

        var primus = new Primus('http://' + userpass + '@localhost:8801',
                                { strategy: false }),
            duplex = new centro.PrimusDuplex(primus),
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

        primus.on('close', function ()
        {
            add_message(tag_text('status', 'closed'));
        });
    });
}
