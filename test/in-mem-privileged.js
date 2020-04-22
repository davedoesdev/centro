/*eslint-env node */
"use strict";

const runner = require('./runner');
const centro = require('..');
const { expect } = require('chai');
const read_all = require('./read_all');

runner({
    transport: {
        server: 'in-mem',
        name: 'in-mem-privileged',
        config: {
            privileged: true
        }
    }
}, (config, server, cb) => {
    server.transport_ops[0].connect((err, stream) => {
        if (err) {
            return cb(err);
        }
        cb(null, centro.stream_auth(stream, config));
    });
}, {
    shared: true,
});

const port = 8700;
let connects = 0;

runner({
    transport: [{
        server: 'in-mem',
        name: 'in-mem-privileged-multi',
        config: {
            privileged: true
        }
    }, {
        server: 'tcp',
        config: {
            port
        }
    }]
}, (config, server, cb) => {
    if (++connects === 1) {
        return server.transport_ops[0].connect((err, stream) => {
            if (err) {
                return cb(err);
            }
            cb(null, centro.stream_auth(stream, config));
        });
    }
    require('net').connect(port, function () {
        this.removeListener('error', cb);
        const conn_err = null;
        this.on('error', err => conn_err = err);
        this.setNoDelay(true);
        const c = centro.stream_auth(this, config);
        if (conn_err) {
            process.nextTick(() => c.emit('error', conn_err));
        }
        cb(null, c);
    }).on('error', cb);
}, {
    shared: true,
    only: (get_info, on_before) => {
        get_info().setup(2, {
            access_control: {
                publish: {
                    allow: ['#'],
                    disallow: []
                },
                subscribe: {
                    allow: ['#'],
                    disallow: []
                }
            },
            separate_tokens: true
        });

        it('should see messages on different transport', function (done) {
            const c0 = get_info().clients[0];
            const c1 = get_info().clients[1];
            const msgs0 = new Map();
            let count0 = 0;
            let count1 = 0;
            let done0 = false;
            let done1 = false;
            function check() {
                if (done0 && done1) {
                    done();
                }
            }
            c0.subscribe('#', (s, info) => {
                expect(++count0).to.be.at.most(2);
                read_all(s, v => {
                    msgs0.set(info.topic, v.toString());
                    if (count0 === 2) {
                        expect(msgs0.get('foo')).to.equal('0');
                        const values = get_info().connections.values();
                        expect(values.next().value.prefixes[0]).to.equal('');
                        expect(msgs0.get(values.next().value.prefixes[0] + 'foo')).to.equal('1');
                        done0 = true;
                        check();
                    }
                });
            }, err => {
                if (err) { return done(err); }
                c1.subscribe('#', (s, info) => {
                    expect(++count1).to.equal(1);
                    expect(info.topic).to.equal('foo');
                    read_all(s, v => {
                        expect(v.toString()).to.equal('1');
                        done1 = true;
                        check();
                    });
                }, err => {
                    if (err) { return done(err); }
                    c0.publish('foo').end('0');
                    c1.publish('foo').end('1');
                });
            });
        });
    }
});
