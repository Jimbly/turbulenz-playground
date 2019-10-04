// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const subscription_manager = require('./subscription_manager.js');
const WSClient = require('./wsclient.js').WSClient;
const wscommon = require('../../common/wscommon.js');

let client;
let subs;

export function init(params) {
  params = params || {};
  if (params.pver) {
    wscommon.PROTOCOL_VERSION = params.pver;
  }
  client = new WSClient();
  subs = subscription_manager.create(client);
  window.subs = subs; // for debugging
  exports.subs = subs;
  exports.client = client;

  if (params.engine) {
    params.engine.addTickFunc((dt) => {
      subs.tick(dt);
    });
  }
}

const build_timestamp_string = new Date(Number(BUILD_TIMESTAMP))
  .toISOString()
  .replace('T', ' ')
  .slice(0, -8);
export function buildString() {
  return build_timestamp_string;
}
