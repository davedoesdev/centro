/*eslint-env node */
"use strict";

const path = require('path');
const webpack = require('webpack');

module.exports = {
    context: __dirname,
    entry: './browser.js',
    output: {
        filename: 'centro.js',
        path: path.join(__dirname, './dist'),
        library: 'centro'
    },
    performance: { hints: false },
    module: {
        rules: [{
            test: /\.js$/,
            enforce: 'pre',
            use: ['source-map-loader']
        }]
    },
    devtool: 'source-map',
    resolve: {
        fallback: {
            crypto: 'crypto-browserify',
            stream: 'stream-browserify',
            util: 'util'
        },
        alias: {
            process: 'process/browser'
        }
    },
    plugins: [
        new webpack.ProvidePlugin({
            process: 'process',
            Buffer: ['buffer', 'Buffer'],
            setImmediate: ['timers-browserify', 'setImmediate']
        })
    ]
};
