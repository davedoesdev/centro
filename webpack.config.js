/*eslint-env node */
"use strict";

var path = require('path');
var webpack = require('webpack');

var ignore = new webpack.IgnorePlugin({
    resourceRegExp: /^bindings$/
});

module.exports = {
    context: __dirname,
    entry: './browser.js',
    output: {
        filename: 'centro.js',
        path: path.join(__dirname, './dist'),
        library: 'centro'
    },
    performance: { hints: false },
    plugins: [ ignore ]
};
