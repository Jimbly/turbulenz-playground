// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
/* global WebSocket, XMLHttpRequest */

const ack = require('../../common/ack.js');
const assert = require('assert');
const { min } = Math;
const walltime = require('./walltime.js');
const wscommon = require('../../common/wscommon.js');

export function WSClient() {
  this.id = null;
  this.handlers = {};
  this.socket = null;
  this.connected = false;
  this.disconnected = false;
  this.retry_scheduled = false;
  this.retry_count = 0;
  this.disconnect_time = Date.now();
  this.last_receive_time = Date.now();
  this.last_send_time = Date.now();
  ack.initReceiver(this);

  let path = document.location.toString().match(/^[^#?]+/u)[0]; // remove search and anchor
  if (path.slice(-1) !== '/') {
    // /file.html or /path/file.html or /path
    let idx = path.lastIndexOf('/');
    if (idx !== -1) {
      let filename = path.slice(idx+1);
      if (filename.indexOf('.') !== -1) {
        path = path.slice(0, idx+1);
      } else {
        path += '/';
      }
    } else {
      path += '/';
    }
  }
  path = path.replace(/^http/u, 'ws');
  this.path = `${path}ws`;

  this.connect(false);

  this.onMsg('cack', this.onConnectAck.bind(this));
  this.onMsg('app_ver', this.onAppVer.bind(this));
  this.onMsg('error', this.onError.bind(this));
}

WSClient.prototype.timeSinceDisconnect = function () {
  return Date.now() - this.disconnect_time;
};

WSClient.prototype.onAppVer = function (ver) {
  if (ver !== BUILD_TIMESTAMP) {
    if (this.on_app_ver_mismatch) {
      this.on_app_ver_mismatch();
    } else {
      console.error(`App version mismatch (server: ${ver}, client: ${BUILD_TIMESTAMP}, reloading`);
      document.location.reload();
    }
  }
};

WSClient.prototype.onConnectAck = function (data, resp_func) {
  let client = this;
  walltime.sync(data.time);
  client.connected = true;
  client.disconnected = false;
  client.id = data.id;
  client.secret = data.secret;
  if (data.app_ver) {
    client.onAppVer(data.app_ver);
  }
  // Fire user-level connect handler as well
  wscommon.handleMessage(client, JSON.stringify({
    msg: 'connect',
    data: {
      client_id: client.id,
    },
  }));
  resp_func();
};


WSClient.prototype.send = function (msg, data, resp_func) {
  wscommon.sendMessage.call(this, msg, data, resp_func);
};

WSClient.prototype.onError = function (e) {
  console.error(e);
  throw e;
};

// cb(client, data, resp_func)
WSClient.prototype.onMsg = function (msg, cb) {
  assert.ok(!this.handlers[msg]);
  this.handlers[msg] = function wrappedCallback(client, data, resp_func) {
    // Client interface does not need a client passed to it!
    return cb(data, resp_func);
  };
};

WSClient.prototype.checkForNewAppVersion = function () {
  if (this.app_ver_check_in_progress) {
    return;
  }
  this.app_ver_check_in_progress = true;
  let xhr = new XMLHttpRequest();
  xhr.open('GET', 'app.ver.json', true);
  xhr.responseType = 'json';
  xhr.onload = () => {
    this.app_ver_check_in_progress = false;
    let obj = xhr.response;
    if (obj && obj.ver) {
      this.onAppVer(obj.ver);
    }
  };
  xhr.onerror = () => {
    this.app_ver_check_in_progress = false;
  };
  xhr.send(null);
};

WSClient.prototype.retryConnection = function () {
  let client = this;
  assert(!client.socket);
  assert(!client.retry_scheduled);
  client.retry_scheduled = true;
  ++client.retry_count;
  this.checkForNewAppVersion();
  setTimeout(function () {
    assert(client.retry_scheduled);
    assert(!client.socket);
    client.retry_scheduled = false;
    client.connect(true);
  }, min(client.retry_count * client.retry_count * 100, 15000));
};

WSClient.prototype.connect = function (for_reconnect) {
  let client = this;

  let path = `${client.path}?pver=${wscommon.PROTOCOL_VERSION}${
    for_reconnect && client.id && client.secret ? `&reconnect=${client.id}&secret=${client.secret}` : ''
  }`;
  let socket = new WebSocket(path);
  client.socket = socket;

  // Protect callbacks from ever firing if we've already disconnected this socket
  //   from the WSClient
  function guard(fn) {
    return function (...args) {
      if (client.socket !== socket) {
        return;
      }
      fn(...args);
    };
  }

  function abort(skip_close) {
    client.socket = null;
    if (client.connected) {
      client.disconnect_time = Date.now();
      client.disconnected = true;
    }
    client.connected = false;
    if (!skip_close) {
      try {
        socket.close();
      } catch (e) {
        // ignore
      }
    }
    ack.failAll(client);
  }

  function retry(skip_close) {
    abort(skip_close);
    client.retryConnection();
  }

  // Local state, for this one connection
  let connected = false;
  client.socket.addEventListener('error', guard(function (err) {
    if (!connected) {
      console.log('WebSocket error during initial connection, retrying...', err);
      retry();
    } else {
      console.error('WebSocket error', err);
      // Disconnect and reconnect here, is this a terminal error? Probably not, we'll get a 'close' event if it is?
      // We some error occasionally on iOS, not sure what error, but it auto-reconnects fine, so let's
      // not do a throw
      // client.onError(err);
    }
  }));

  client.socket.addEventListener('message', guard(function (data) {
    wscommon.handleMessage(client, data.data);
  }));

  client.socket.addEventListener('open', guard(function () {
    console.log('WebSocket open');
    connected = true;
    // reset retry count so next retry is fast if we get disconnected
    client.retry_count = 0;
  }));

  client.socket.addEventListener('close', guard(function () {
    console.log('WebSocket close, retrying connection...');
    retry(true);
  }));

  let doPing = guard(function () {
    if (Date.now() - client.last_send_time > wscommon.PING_TIME && client.connected) {
      client.send('ping');
    }
    setTimeout(doPing, wscommon.PING_TIME);
  });
  setTimeout(doPing, wscommon.PING_TIME);

  // For debugging reconnect handling
  // setTimeout(function () {
  //   if (connected) {
  //     socket.close();
  //   }
  // }, 5000);
};
