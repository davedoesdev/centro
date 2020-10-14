/*eslint-env node */
"use strict";

var path = require('path');
var webpack = require('webpack');
var TerserPlugin = require('terser-webpack-plugin');

module.exports = {
    context: __dirname,
    entry: './browser.js',
    output: {
        filename: 'centro.js',
        path: path.join(__dirname, './dist'),
        library: 'centro'
    },
    performance: { hints: false },
    optimization: {
        minimize: true,
        minimizer: [
            new TerserPlugin({
                terserOptions: {
                    output: {
                        comments: false
                    }
                },
                extractComments: false
            })
        ]
    },
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
        }
    }
};
