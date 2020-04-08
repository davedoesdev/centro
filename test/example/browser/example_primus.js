/*eslint-env browser */
/*eslint-disable no-unused-vars, no-undef */

let publish = function (event) { // <1>
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

    function add_message(div) { // <2>
        messages.appendChild(div);
        messages.scrollTop = messages.scrollHeight;
    }

    centro.separate_auth({
        token: params.get('token')
    }, function (err, userpass, make_client) {
        if (err) { throw(err); }

        const primus = new Primus('http://' + userpass + '@localhost:8801',
                                  { strategy: false });
        const duplex = new centro.PrimusDuplex(primus);
        const client = make_client(duplex);

        client.on('ready', function () {
            add_message(tag_text('status', 'open')); // <3>
            this.subscribe(params.get('subscribe'), function (s, info) {
                centro.read_all(s, function (v) {
                    const msg = document.createElement('div');
                    msg.className = 'message';
                    msg.appendChild(tag_text('topic', info.topic));
                    msg.appendChild(tag_text('data', v.toString()));
                    add_message(msg); // <4>
                });
            });

            publish = function (event) {
                event.preventDefault();
                client.publish(topic.value).end(message.value); // <5>
            };
        });

        primus.on('close', function () {
            add_message(tag_text('status', 'closed')); // <6>
        });
    });
}
