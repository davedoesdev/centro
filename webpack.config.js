var webpack = require('webpack'),
    path = require('path');

module.exports = {
    context: __dirname,
    entry: './browser.js',
    output: {
        filename: 'centro.js',
        path: path.join(__dirname, './dist'),
        library: 'centro'
    },
    performance: { hints: false }
};
