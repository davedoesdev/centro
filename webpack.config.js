var webpack = require('webpack'),
    path = require('path');

module.exports = {
    context: __dirname,
    entry: './lib/client.js',
    output: {
        filename: 'centro.js',
        path: path.join(__dirname, './dist')
    },
    module: {
        loaders: [
            { test: /\.json$/, loader: 'json' }
        ]
    },
    plugins: [
        new webpack.IgnorePlugin(/regenerator|nodent|js-beautify/, /ajv/) 
    ]
};
