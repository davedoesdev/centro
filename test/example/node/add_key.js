/*eslint-env node */
"use strict";

const uri = 'http://davedoesdev.com'; // <1>
const authorize_jwt = require('authorize-jwt');
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { JWK } = require('jose');
const priv_key = JWK.generateSync('OKP'); // <2>
const pub_key = priv_key.toPEM(); // <3>

authorize_jwt({
    db_type: 'pouchdb', // <4>
    db_for_update: true, // <5>
    no_changes: true // <6>
}, function (err, authz) {
    assert.ifError(err);
    authz.keystore.add_pub_key(uri, pub_key, function (err) { // <7>
        assert.ifError(err);
        authz.keystore.deploy(); // <8>
        fs.writeFile(path.join(__dirname, 'priv_key.pem'), // <9>
                     priv_key.toPEM(true),
                     assert.ifError);
    });
});
