var uri = 'http://davedoesdev.com',
    pub_keystore = require('pub-keystore'),
    assert = require('assert'),
    path = require('path'),
    fs = require('fs'),
    ursa = require('ursa'),
    priv_key = ursa.generatePrivateKey(2048, 65537),
    pub_key = priv_key.toPublicPem('utf8');

pub_keystore(
{
    db_type: 'pouchdb',
    db_for_update: true,
    no_changes: true
}, function (err, ks)
{
    assert.ifError(err);
    ks.add_pub_key(uri, pub_key, function (err)
    {
        assert.ifError(err);
        fs.writeFile(path.join(__dirname, 'priv_key.pem'),
                     priv_key.toPrivatePem(),
                     assert.ifError);
    });
    ks.deploy();
});
