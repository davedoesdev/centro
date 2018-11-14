/*eslint-env node */
"use strict";

var uri = 'http://davedoesdev.com',
    authorize_jwt = require('../../..').authorize_jwt,
    assert = require('assert'),
    path = require('path'),
    fs = require('fs'),
    jsjws = require('jsjws'),
    priv_key = jsjws.generatePrivateKey(2048, 65537),
    pub_key = priv_key.toPublicPem();

authorize_jwt(
{
    db_type: 'pouchdb',
    db_for_update: true,
    no_changes: true
}, function (err, authz)
{
    assert.ifError(err);
    authz.keystore.add_pub_key(uri, pub_key, function (err)
    {
        assert.ifError(err);
        authz.keystore.deploy();
        fs.writeFile(path.join(__dirname, 'priv_key.pem'),
                     priv_key.toPrivatePem(),
                     assert.ifError);
    });
});
