var uri = 'http://davedoesdev.com',
    pub_keystore = require('pub-keystore'),
    jsjws = require('jsjws'),
    assert = require('assert'),
    path = require('path'),
    fs = require('fs'),
    ursa = require('ursa');

fs.readFile(path.join(__dirname, 'priv_key.pem'), function (err, priv_key)
{
    assert.ifError(err);

    var expiry = new Date();
    expiry.setHours(expiry.getHours() + 1);

    pub_keystore(
    {
        db_type: 'pouchdb',
        deploy_name: 'token',
        no_changes: true,
        silent: true
    }, function (err, ks)
    {
        assert.ifError(err);
        ks.get_pub_key_by_uri(uri, function (err, pub_key, issuer_id)
        {
            assert.ifError(err);
            assert(pub_key);
            assert(issuer_id);
            console.log(new jsjws.JWT().generateJWTByKey(
            {
                alg: 'PS256'
            },
            {
                iss: issuer_id,
                access_control: {
                    subscribe: {
                        allow: ['#'],
                        disallow: []
                    },
                    publish: {
                        allow: ['#'],
                        disallow: []
                    }
                }
            }, expiry, ursa.createPrivateKey(priv_key)));
        });
    });
});
