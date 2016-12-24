function connect()
{
    var topic = document.getElementById('topic'),
        message = document.getElementById('message'),
        messages = document.getElementById('messages'),
        params = new URLSearchParams(window.location.search);

    function add_status(s)
    {
        var status = document.createElement('div');
        status.className = 'status';
        status.appendChild(document.createTextNode(s));
        messages.appendChild(status);
        messages.scrollTop = messages.scrollHeight;
    }

    var source = new EventSource('http://localhost:8801/centro/v1/subscribe?authz_token=' + params.get('token') + '&topic=' + encodeURIComponent(params.get('subscribe')));

    source.onopen = function ()
    {
        publish = function ()
        {
            var r = new XMLHttpRequest();
            r.open('POST', 'http://localhost:8801/centro/v1/publish?authz_token=' + params.get('token') + '&topic=' + encodeURIComponent(topic.value));
            r.send(message.value);
        };

        add_status('open');
    };

    source.onerror = function (e)
    {
        if (e.target.readyState === EventSource.CONNECTING)
        {
            add_status('connecting');
        }
        else if (e.target.readyState === EventSource.CLOSED)
        {
            add_status('closed');
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
        msgs.get(info.id).data += atob(info.data);
    });

    source.addEventListener('end', function (e)
    {
        var info = msgs.get(JSON.parse(e.data).id);

        var msg = document.createElement('div');
        msg.className = 'message';

        var topic = document.createElement('div');
        topic.className = 'topic';
        topic.appendChild(document.createTextNode(info.topic));
        msg.appendChild(topic);

        var data = document.createElement('div');
        data.className = 'data';
        data.appendChild(document.createTextNode(info.data));
        msg.appendChild(data);

        messages.appendChild(msg);
        messages.scrollTop = messages.scrollHeight;

        msgs.delete(info.id);
    });

    source.addEventListener('peer_error', function ()
    {
        add_status('error');
    });
}

var publish = function () {};
