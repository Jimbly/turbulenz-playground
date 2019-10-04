// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const argv = require('minimist')(process.argv.slice(2));
const assert = require('assert');
const data_store = require('./data_store.js');
const glov_channel_server = require('./channel_server.js');
const fs = require('fs');
const log = require('./log.js');
const path = require('path');
const glov_wsserver = require('./wsserver.js');
const glov_wscommon = require('../../common/wscommon.js');

const STATUS_TIME = 5000;
let ds_store;
export let ws_server;
export let channel_server;

let last_status = '';
function displayStatus() {
  setTimeout(displayStatus, STATUS_TIME);
  let status = channel_server.getStatus();
  if (status !== last_status) {
    console.info('STATUS', new Date().toISOString(), status);
    last_status = status;
  }
}

let last_version = {};
function updateVersion(base_name, is_startup) {
  let version_file_name = path.join(__dirname, `../../client/${base_name}.ver.json`);
  fs.readFile(version_file_name, function (err, data) {
    if (err) {
      // ignore, probably being written to
      return;
    }
    let obj;
    try {
      obj = JSON.parse(data);
    } catch (e) {
      return;
    }
    if (!obj || !obj.ver) {
      return;
    }
    let old_version = last_version[base_name];
    if (old_version === obj.ver) {
      return;
    }
    console.info(`Version for "${base_name}"${old_version ? ' changed to' : ''}: ${obj.ver}`);
    last_version[base_name] = obj.ver;
    if (base_name === 'app' && !is_startup) {
      // Do a broadcast message so people get a few seconds of warning
      ws_server.broadcast('admin_msg', 'New client version deployed, reloading momentarily...');
      ws_server.setAppVer(obj.ver);
      if (argv.dev) {
        // immediate
        ws_server.broadcast('app_ver', last_version.app);
      } else {
        // delay by 15 seconds, the server may also be about to be restarted
        setTimeout(function () {
          ws_server.broadcast('app_ver', last_version.app);
        }, 15000);
      }
    }
  });
}

export function startup(params) {
  log.startup(argv);
  assert(params.server);
  if (params.pver) {
    glov_wscommon.PROTOCOL_VERSION = params.pver;
  }
  ds_store = params.ds || data_store.create('data_store');
  channel_server = glov_channel_server.create();

  ws_server = glov_wsserver.create(params.server);
  ws_server.on('error', function (error) {
    console.error('Unhandled WSServer error:', error);
    channel_server.handleUncaughtError(error);
  });

  channel_server.init(ds_store, ws_server);

  process.on('uncaughtException', channel_server.handleUncaughtError.bind(channel_server));
  setTimeout(displayStatus, STATUS_TIME);

  fs.watch(path.join(__dirname, '../../client/'), function (eventType, filename) {
    if (!filename) {
      return;
    }
    let m = filename.match(/(.*)\.ver\.json$/u);
    if (!m) {
      // not a version file, ignore
      return;
    }
    let file_base_name = m[1]; // e.g. 'app' or 'worker'
    updateVersion(file_base_name);
  });
  updateVersion('app', true);
}
