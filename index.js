"use strict";

exports.authorize_jwt = require('authorize-jwt');

Object.assign(exports,
              require('./lib/client.js'),
              require('./lib/server.js'));
