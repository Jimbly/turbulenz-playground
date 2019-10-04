// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const ack = require('./ack.js');
const { logdata } = require('./util.js');

export const LOG_MESSAGES = false;
export const CONNECTION_TIMEOUT = 60000;
export const PING_TIME = CONNECTION_TIMEOUT / 2;
exports.PROTOCOL_VERSION = '1';

function sendMessageInternal(client, msg, err, data, resp_func) {
  if (!client.connected || client.socket.readyState !== 1) { // WebSocket.OPEN
    (client.log ? client : console).log('Attempting to send on a disconnected link, ignoring', { msg, err, data });
    if (!client.log && client.onError && msg && typeof msg !== 'number') {
      // On the client, if we try to send a new packet while disconnected, this is an application error
      client.onError(`Attempting to send msg=${msg} on a disconnected link`);
    }
  } else {
    let net_data = ack.wrapMessage(client, msg, err, data, resp_func);
    client.socket.send(JSON.stringify(net_data));
    client.last_send_time = Date.now();
  }
}

export function sendMessage(msg, data, resp_func) {
  sendMessageInternal(this, msg, null, data, resp_func); // eslint-disable-line no-invalid-this
}

export function handleMessage(client, net_data) {
  let now = Date.now();
  let source = client.id ? `client ${client.id}` : 'server';
  try {
    net_data = JSON.parse(net_data);
  } catch (e) {
    (client.log ? client : console).log(`Error parsing data from ${source}`);
    return client.onError(e);
  }
  client.last_receive_time = now;

  if (LOG_MESSAGES) {
    console.debug(`wscommon.receive ${
      typeof net_data.msg==='number' ?
        `ack(${net_data.msg})` :
        net_data.msg
    }${net_data.pak_id ? `(${net_data.pak_id})` : ''}${
      net_data.err ? ` err:${net_data.err}` : ''} ${logdata(net_data.data)}`);
  }

  return ack.handleMessage(client, source, net_data, function sendFunc(msg, err, data, resp_func) {
    if (resp_func && !resp_func.expecting_response) {
      resp_func = null;
    }
    if (err) {
      (client.log ? client : console).log(`Error "${err}" sent to ${source} in response to ${
        net_data.msg} ${logdata(net_data.data)}`);
    }
    sendMessageInternal(client, msg, err, data, resp_func);
  }, function handleFunc(msg, data, resp_func) {
    let handler = client.handlers[msg];
    if (!handler) {
      let error_msg = `No handler for message ${JSON.stringify(msg)} from ${source}`;
      console.error(error_msg, data);
      if (client.onError) {
        return client.onError(error_msg);
      }
      return resp_func(error_msg);
    }
    return handler(client, data, resp_func);
  });
}
