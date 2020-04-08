/*eslint-env browser */
/*eslint-disable no-unused-vars */

let publish = function (event) {
    'use strict';
    event.preventDefault();
};

function connect() {
    'use strict';

    const topic = document.getElementById('topic');
    const message = document.getElementById('message');
    const messages = document.getElementById('messages');
    const params = new URLSearchParams(window.location.search);

    function tag_text(cls, text) {
        const div = document.createElement('div');
        div.className = cls;
        div.appendChild(document.createTextNode(text));
        return div;
    }

    function add_message(div) {
        messages.appendChild(div);
        messages.scrollTop = messages.scrollHeight;
    }

    const base_url = 'http://localhost:8802/centro/v2/';
    const source = new EventSource(base_url + // <1>
        'subscribe?authz_token=' + params.get('token') +
        '&topic=' + encodeURIComponent(params.get('subscribe')));

    source.onopen = function () {
        publish = function (event) {
            event.preventDefault();
            var r = new XMLHttpRequest();
            r.open('POST', base_url + // <2>
                'publish?authz_token=' + params.get('token') +
                '&topic=' + encodeURIComponent(topic.value));
            r.send(message.value); // <3>
        };

        add_message(tag_text('status', 'open'));
    };

    source.onerror = function (e) {
        if (e.target.readyState === EventSource.CONNECTING) {
            add_message(tag_text('status', 'connecting'));
        } else if (e.target.readyState === EventSource.CLOSED) {
            add_message(tag_text('status', 'closed'));
        }
    };

    const msgs = new Map();

    source.addEventListener('start', function (e) {
        const info = JSON.parse(e.data); // <4>
        info.data = ''; // <5>
        msgs.set(info.id, info); // <6>
    });

    source.addEventListener('data', function (e) {
        const info = JSON.parse(e.data);
        msgs.get(info.id).data += info.data; // <7>
    });

    source.addEventListener('end', function (e) {
        const info = msgs.get(JSON.parse(e.data).id); // <8>

        const msg = document.createElement('div');
        msg.className = 'message';
        msg.appendChild(tag_text('topic', info.topic));
        msg.appendChild(tag_text('data', info.data));
        add_message(msg);

        msgs.delete(info.id);
    });

    source.addEventListener('peer_error', function () {
        add_message(tag_text('status', 'error'));
    });
}
