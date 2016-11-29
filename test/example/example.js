function connect()
{
    var topic = document.getElementById('topic'),
        message = document.getElementById('message'),
        params = new URLSearchParams(window.location.search);

    centro.separate_auth(
    {
        token: params.get('token')
    }, function (err, userpass, make_client)
    {
        if (err)
        {
            throw(err);
        }

        var primus = new Primus('http://' + userpass + '@localhost:8801',
        {
            strategy: false
        });

        primus.on('open', function ()
        {
            var status = document.createElement('div');
            status.className = 'status';
            status.appendChild(document.createTextNode('open'));
            document.body.appendChild(status);

            var client = make_client(new centro.PrimusDuplex(primus));

            client.on('ready', function ()
            {
                this.subscribe(params.get('subscribe'), function (s, info)
                {
                    centro.read_all(s, function (v)
                    {
                        var msg = document.createElement('div');
                        msg.className = 'message';

                        var topic = document.createElement('div');
                        topic.className = 'topic';
                        topic.appendChild(document.createTextNode(info.topic));
                        msg.appendChild(topic);

                        var data = document.createElement('div');
                        data.className = 'data';
                        data.appendChild(document.createTextNode(v.toString()));
                        msg.appendChild(data);

                        document.body.appendChild(msg);
                    });
                });

                publish = function ()
                {
                    var s = client.publish(topic.value);
                    if (s)
                    {
                        s.end(message.value);
                    }
                };
            });
        });

        primus.on('close', function ()
        {
            var status = document.createElement('div');
            status.className = 'status';
            status.appendChild(document.createTextNode('closed'));
            document.body.appendChild(status);
        });
    });
}

var publish = function () {};
