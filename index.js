/**
 * Pub-sub and work queue server. Wildcards, streams, back-pressure,
 * multi-transport. Just Node and a filesystem required.
 *
 * Re-exports all exports of {@link centro-js/lib/client} and {@link centro-js/lib/server}
 * @module centro-js
 */
"use strict";

exports.authorize_jwt = require('authorize-jwt');

Object.assign(exports,
              require('./lib/client'),
              require('./lib/server'));
