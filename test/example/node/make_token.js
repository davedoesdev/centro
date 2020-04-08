/*eslint-env node */
/*eslint-disable no-console */
"use strict";

const uri = 'http://davedoesdev.com';
const authorize_jwt = require('authorize-jwt');
const { JWK, JWT } = require('jose');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

fs.readFile(path.join(__dirname, 'priv_key.pem'), function (err, priv_key) { // <1>
    assert.ifError(err);

    authorize_jwt( // <2>
    {
        db_type: 'pouchdb',
        deploy_name: 'token',
        no_changes: true
    }, function (err, authz)
    {
        assert.ifError(err);
        authz.keystore.get_pub_key_by_uri(uri, function (err, pub_key, issuer_id) // <3>
        {
            assert.ifError(err);
            assert(pub_key);
            assert(issuer_id);
            console.log(JWT.sign({
                 access_control: { // <4>
                    subscribe: { allow: ['#'], disallow: [] },
                    publish: { allow: ['#'], disallow: [] }
                 }
            }, JWK.asKey(priv_key), { // <5>
                algorithm: 'EdDSA',
                issuer: issuer_id, // <6>
                expiresIn: '1d' // <7>
            }));
        });
    });
});
