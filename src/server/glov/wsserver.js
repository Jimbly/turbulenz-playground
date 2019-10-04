// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const ack = require('../../common/ack.js');
const assert = require('assert');
const events = require('../../common/tiny-events.js');
const node_util = require('util');
const querystring = require('querystring');
const { ipFromRequest } = require('./request_utils.js');
const util = require('../../common/util.js');
const url = require('url');
const wscommon = require('../../common/wscommon.js');
const WebSocket = require('ws');

function WSClient(ws_server, socket) {
  events.EventEmitter.call(this);
  this.ws_server = ws_server;
  this.socket = socket;
  this.id = ++ws_server.last_client_id;
  this.secret = Math.ceil(Math.random() * 1e10).toString();
  this.addr = ipFromRequest(socket.handshake);
  this.handlers = ws_server.handlers; // reference, not copy!
  this.connected = true;
  this.disconnected = false;
  this.last_receive_time = Date.now();
  ack.initReceiver(this);
  ws_server.clients[this.id] = this;
}
util.inherits(WSClient, events.EventEmitter);

WSClient.prototype.log = function (...args) {
  let client = this;
  let msg = [];
  for (let ii = 0; ii < arguments.length; ++ii) {
    if (typeof args[ii] === 'object') {
      msg.push(node_util.inspect(args[ii]));
    } else {
      msg.push(args[ii]);
    }
  }
  console.log(`WS Client ${client.id} ${msg.join(' ')}`);
};

WSClient.prototype.onError = function (e) {
  this.ws_server.emit('error', e);
};

WSClient.prototype.onClose = function () {
  let client = this;
  if (!client.connected) {
    return;
  }
  let ws_server = client.ws_server;
  client.connected = false;
  client.disconnected = true;
  delete ws_server.clients[client.id];
  console.info(`WS Client ${client.id} disconnected` +
    ` (${Object.keys(ws_server.clients).length} clients connected)`);
  ack.failAll(client); // Should this be before or after other disconnect events?
  client.emit('disconnect');
  ws_server.emit('disconnect', client);
};

WSClient.prototype.send = wscommon.sendMessage;

function WSServer() {
  events.EventEmitter.call(this);
  this.wss = null;
  this.last_client_id = 0;
  this.clients = Object.create(null);
  this.handlers = {};
  this.restarting = false;
  this.app_ver = 0;
  this.onMsg('ping', util.nop);
}
util.inherits(WSServer, events.EventEmitter);

// cb(client, data, resp_func)
WSServer.prototype.onMsg = function (msg, cb) {
  assert.ok(!this.handlers[msg]);
  this.handlers[msg] = cb;
};

WSServer.prototype.init = function (server) {
  let ws_server = this;
  ws_server.wss = new WebSocket.Server({ noServer: true });

  // Doing my own upgrade handling to early-reject invalid protocol versions
  server.on('upgrade', (req, socket, head) => {
    let query = querystring.parse(url.parse(req.url).query);
    if (!query.pver || String(query.pver) !== wscommon.PROTOCOL_VERSION) {
      console.log(`WS Client rejected (bad pver) from ${ipFromRequest(req)}: ${req.url}`);
      socket.write('HTTP/1.1 400 Invalid Protocol\r\n\r\n');
      socket.end();
      socket.destroy();
      return;
    }

    ws_server.wss.handleUpgrade(req, socket, head, function done(ws) {
      ws_server.wss.emit('connection', ws, req);
    });
  });

  ws_server.wss.on('connection', (socket, req) => {
    socket.handshake = req;
    let client = new WSClient(ws_server, socket);
    console.info(`WS Client ${client.id} connected to ${req.url} from ${client.addr}` +
      ` (${Object.keys(ws_server.clients).length} clients connected)`);

    socket.on('close', function () {
      // disable this for testing
      client.onClose();
    });
    socket.on('message', function (data) {
      wscommon.handleMessage(client, data);
    });
    socket.on('error', function (e) {
      // Not sure this exists on `ws`
      client.onError(e);
    });
    ws_server.emit('client', client);

    // after the .emit('client') has a chance to set client.client_id
    client.send('cack', {
      id: client.client_id || client.id,
      secret: client.secret,
      app_ver: this.app_ver,
      time: Date.now(),
    });

    let query = querystring.parse(url.parse(req.url).query);
    let reconnect_id = Number(query.reconnect);
    if (reconnect_id) {
      // we're reconnecting an existing client, immediately disconnect the old one
      let old_client = ws_server.clients[reconnect_id];
      if (old_client) {
        if (old_client.secret === query.secret) {
          console.info(`WS Client ${old_client.id} being replaced by reconnect, disconnecting...`);
          this.disconnectClient(old_client);
        } else {
          console.log(`WS Client ${client.id} requested disconnect of Client ${reconnect_id}` +
            ' with incorrect secret, ignoring');
        }
      }
    }
  });

  setInterval(this.checkTimeouts.bind(this), wscommon.CONNECTION_TIMEOUT / 2);
};

WSServer.prototype.disconnectClient = function (client) {
  try {
    client.socket.close();
  } catch (err) {
    // ignore
  }
  client.onClose();
};

WSServer.prototype.checkTimeouts = function () {
  let expiry = Date.now() - wscommon.CONNECTION_TIMEOUT;
  for (let client_id in this.clients) {
    let client = this.clients[client_id];
    if (client.last_receive_time < expiry) {
      console.info(`WS Client ${client.id} timed out, disconnecting...`);
      this.disconnectClient(client);
    }
  }
};

WSServer.prototype.broadcast = function (msg, data) {
  let ws_server = this;
  let num_sent = 0;
  for (let client_id in ws_server.clients) {
    if (ws_server.clients[client_id]) {
      let client = ws_server.clients[client_id];
      client.send(msg, data);
      ++num_sent;
    }
  }
  return num_sent;
};

WSServer.prototype.setAppVer = function (ver) {
  this.app_ver = ver;
};

export function isClient(obj) {
  return obj instanceof WSClient;
}

WSServer.prototype.isClient = isClient;

export function create(...args) {
  let ret = new WSServer();
  ret.init(...args);
  return ret;
}
