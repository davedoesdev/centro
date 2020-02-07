/*eslint-env node */
/*eslint-disable no-console */
"use strict";

var uri = 'http://davedoesdev.com',
    authorize_jwt = require('../../..').authorize_jwt,
    jsjws = require('jsjws'),
    assert = require('assert'),
    path = require('path'),
    fs = require('fs');

fs.readFile(path.join(__dirname, 'priv_key.pem'), function (err, priv_key)
{
    assert.ifError(err);

    var expiry = new Date();
    expiry.setHours(expiry.getHours() + 24);

    authorize_jwt(
    {
        db_type: 'pouchdb',
        deploy_name: 'token',
        no_changes: true
    }, function (err, authz)
    {
        assert.ifError(err);
        authz.keystore.get_pub_key_by_uri(uri, function (err, pub_key, issuer_id)
        {
            assert.ifError(err);
            assert(pub_key);
            assert(issuer_id);
            console.log(new jsjws.JWT().generateJWTByKey({ alg: 'PS256' },
            {
                iss: issuer_id,
                access_control: {
                    subscribe: { allow: ['#'], disallow: [] },
                    publish: { allow: ['#'], disallow: [] }
                }
            }, expiry, jsjws.createPrivateKey(priv_key)));
        });
    });
});
