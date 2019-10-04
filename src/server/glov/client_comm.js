// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const assert = require('assert');
const client_worker = require('./client_worker.js');
const { channelServerSend } = require('./channel_server.js');
const { logdata } = require('../../common/util.js');
const random_names = require('./random_names.js');

function onUnSubscribe(client, channel_id) {
  client.client_channel.unsubscribeOther(channel_id);
}

function onClientDisconnect(client) {
  client.client_channel.unsubscribeAll();
  client.client_channel.shutdown();
}

function onSubscribe(client, channel_id, resp_func) {
  console.debug(`client_id:${client.id}->${channel_id}: subscribe`);
  client.client_channel.subscribeOther(channel_id, resp_func);
}

function onSetChannelData(client, data, resp_func) {
  data.key = String(data.key);
  let channel_id = data.channel_id;
  assert(channel_id);

  let key = data.key.split('.');
  if (key[0] !== 'public' && key[0] !== 'private') {
    console.error(` - failed, invalid scope: ${key[0]}`);
    resp_func('failed: invalid scope');
    return;
  }
  if (!key[1]) {
    console.error(' - failed, missing member name');
    resp_func('failed: missing member name');
    return;
  }

  // TODO: Disable autocreate for this call?
  // TODO: Error if channel does not exist, but do not require an ack? channelServerSend needs a simple "sent" ack?

  let client_channel = client.client_channel;

  if (!client_channel.isSubscribedTo(channel_id)) {
    return void resp_func(`Client is not on channel ${channel_id}`);
  }

  client_channel.ids = client_channel.ids_direct;
  channelServerSend(client_channel, channel_id, 'set_channel_data', null, data);
  client_channel.ids = client_channel.ids_base;
  resp_func();
}

function applyCustomIds(ids, user_data_public) {
  // FRVR - maybe generalize this
  let perm = user_data_public.permissions;
  if (perm) {
    if (perm.admin) {
      ids.admin = 1;
    }
  }
}

function quietMessage(msg) {
  // FRVR - maybe generalize this?
  return msg && (msg.msg === 'set_user' && msg.data && msg.data.key === 'pos' ||
    msg.msg === 'vd_get' || msg.msg === 'claim');
}

function onChannelMsg(client, data, resp_func) {
  // Arbitrary messages, or messages to everyone subscribed to the channel, e.g. chat
  if (quietMessage(data)) {
    if (typeof data.data === 'object') {
      data.data.q = 1; // do not print later, either
    }
  } else {
    console.debug(`client_id:${client.id}->${data.channel_id}: channel_msg ${logdata(data)}`);
  }
  if (typeof data !== 'object') {
    return void resp_func('Invalid data type');
  }
  let channel_id = data.channel_id;
  if (!channel_id) {
    return void resp_func('Missing channel_id');
  }
  let client_channel = client.client_channel;

  if (!client_channel.isSubscribedTo(channel_id)) {
    return void resp_func(`Client is not on channel ${channel_id}`);
  }
  if (data.broadcast && typeof data.data !== 'object') {
    return void resp_func('Broadcast requires data object');
  }
  if (!resp_func.expecting_response) {
    resp_func = null;
  }
  if (data.broadcast) {
    delete data.broadcast;
    channelServerSend(client_channel, channel_id, 'broadcast', null, data, resp_func);
  } else {
    client_channel.ids = client_channel.ids_direct;
    channelServerSend(client_channel, channel_id, data.msg, null, data.data, resp_func);
    client_channel.ids = client_channel.ids_base;
  }
}

const regex_valid_username = /^[a-z][a-z0-9_]+$/u;
const invalid_names = {
  constructor: 1,
  hasownproperty: 1,
  isprototypeof: 1,
  propertyisenumerable: 1,
  tolocalestring: 1,
  tostring: 1,
  valueof: 1,
  admin: 1,
};
function validUsername(user_id) {
  if (!user_id) {
    return false;
  }
  if ({}[user_id]) {
    // hasOwnProperty, etc
    return false;
  }
  user_id = user_id.toLowerCase();
  if (invalid_names[user_id]) {
    // also catches anything on Object.prototype
    return false;
  }
  if (!user_id.match(regex_valid_username)) {
    // has a "." or other invalid character
    return false;
  }
  return true;
}

function handleLoginResponse(client, user_id, resp_func, err, resp_data) {
  let client_channel = client.client_channel;
  assert(client_channel);

  if (client_channel.ids.user_id) {
    // Logged in while processing the response?
    return resp_func('Already logged in');
  }

  if (!err) {
    client_channel.ids_base.user_id = user_id;
    client_channel.ids_base.display_name = resp_data.display_name;
    applyCustomIds(client_channel.ids, resp_data);

    // Tell channels we have a new user id/display name
    for (let channel_id in client_channel.subscribe_counts) {
      channelServerSend(client_channel, channel_id, 'client_changed');
    }

    // Always subscribe client to own user
    onSubscribe(client, `user.${user_id}`);
  }
  return resp_func(err, client_channel.ids); // user_id and display_name
}

function onLogin(client, data, resp_func) {
  console.log(`client_id:${client.id}->server login ${logdata(data)}`);
  let user_id = data.user_id;
  if (!validUsername(user_id)) {
    return resp_func('Invalid username');
  }
  user_id = user_id.toLowerCase();

  let client_channel = client.client_channel;
  assert(client_channel);

  return channelServerSend(client_channel, `user.${user_id}`, 'login', null, {
    display_name: data.display_name || data.user_id, // original-case'd name
    password: data.password,
    salt: client.secret,
    ip: client.addr,
  }, handleLoginResponse.bind(null, client, user_id, resp_func));
}

function onUserCreate(client, data, resp_func) {
  console.log(`client_id:${client.id}->server user_create ${logdata(data)}`);
  let user_id = data.user_id;
  if (!validUsername(user_id)) {
    return resp_func('Invalid username');
  }
  user_id = user_id.toLowerCase();

  let client_channel = client.client_channel;
  assert(client_channel);

  if (client_channel.ids.user_id) {
    return resp_func('Already logged in');
  }

  return channelServerSend(client_channel, `user.${user_id}`, 'create', null, {
    display_name: data.display_name || data.user_id, // original-case'd name
    password: data.password,
    email: data.email,
    ip: client.addr,
  }, handleLoginResponse.bind(null, client, user_id, resp_func));
}

function onLogOut(client, data, resp_func) {
  let client_channel = client.client_channel;
  assert(client_channel);
  let { user_id } = client_channel.ids;
  console.log(`client_id:${client.id}->server logout ${user_id}`);
  if (!user_id) {
    return resp_func('ERR_NOT_LOGGED_IN');
  }

  onUnSubscribe(client, `user.${user_id}`);
  delete client_channel.ids_base.user_id;
  delete client_channel.ids_base.display_name;

  // Tell channels we have a new user id/display name
  for (let channel_id in client_channel.subscribe_counts) {
    channelServerSend(client_channel, channel_id, 'client_changed');
  }

  return resp_func();
}

function onRandomName(client, data, resp_func) {
  return resp_func(null, random_names.get());
}

export function init(channel_server) {
  let ws_server = channel_server.ws_server;
  ws_server.on('client', (client) => {
    let client_id = channel_server.clientIdFromWSClient(client);
    client.client_id = client_id;
    client.client_channel = channel_server.createChannelLocal(`client.${client_id}`);
    client.client_channel.client = client;
  });
  ws_server.on('disconnect', onClientDisconnect);
  ws_server.onMsg('subscribe', onSubscribe);
  ws_server.onMsg('unsubscribe', onUnSubscribe);
  ws_server.onMsg('set_channel_data', onSetChannelData);
  ws_server.onMsg('channel_msg', onChannelMsg);
  ws_server.onMsg('login', onLogin);
  ws_server.onMsg('user_create', onUserCreate);
  ws_server.onMsg('logout', onLogOut);
  ws_server.onMsg('random_name', onRandomName);

  client_worker.init(channel_server);
}
