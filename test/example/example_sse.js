var publish = function () { event.preventDefault(); };

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

    var base_url = 'http://localhost:8802/centro/v1/',
        source = new EventSource(base_url +
                                 'subscribe?authz_token=' + params.get('token') +
                                 '&topic=' + encodeURIComponent(params.get('subscribe')));

    source.onopen = function ()
    {
        publish = function ()
        {
            event.preventDefault();
            var r = new XMLHttpRequest();
            r.open('POST', base_url +
                           'publish?authz_token=' + params.get('token') +
                           '&topic=' + encodeURIComponent(topic.value));
            r.send(message.value);
        };

        add_message(tag_text('status', 'open'));
    };

    source.onerror = function (e)
    {
        if (e.target.readyState === EventSource.CONNECTING)
        {
            add_message(tag_text('status', 'connecting'));
        }
        else if (e.target.readyState === EventSource.CLOSED)
        {
            add_message(tag_text('status', 'closed'));
        }
    };

    var msgs = new Map();

    source.addEventListener('start', function (e)
    {
        var info = JSON.parse(e.data);
        info.data = '';
        msgs.set(info.id, info);
    });

    source.addEventListener('data', function (e)
    {
        var info = JSON.parse(e.data);
        msgs.get(info.id).data += info.data;
    });

    source.addEventListener('end', function (e)
    {
        var info = msgs.get(JSON.parse(e.data).id);

        var msg = document.createElement('div');
        msg.className = 'message';
        msg.appendChild(tag_text('topic', info.topic));
        msg.appendChild(tag_text('data', info.data));
        add_message(msg);

        msgs.delete(info.id);
    });

    source.addEventListener('peer_error', function ()
    {
        add_message(tag_text('status', 'error'));
    });
}
