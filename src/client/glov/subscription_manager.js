// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const assert = require('assert');
const dot_prop = require('dot-prop');
const EventEmitter = require('../../common/tiny-events.js');
const local_storage = require('./local_storage.js');
const md5 = require('../../common/md5.js');
const util = require('../../common/util.js');

// relevant events:
//   .on('channel_data', cb(data [, mod_key, mod_value]));

function ClientChannelWorker(subs, channel_id) {
  EventEmitter.call(this);
  this.subs = subs;
  this.channel_id = channel_id;
  this.subscriptions = 0;
  this.subscribe_failed = false;
  this.got_subscribe = false;
  this.handlers = {};
  this.data = {};
  this.onMsg('channel_data', this.handleChannelData.bind(this));
  this.onMsg('apply_channel_data', this.handleApplyChannelData.bind(this));
}
util.inherits(ClientChannelWorker, EventEmitter);

// cb(data)
ClientChannelWorker.prototype.onSubscribe = function (cb) {
  assert(this.subscriptions || this.autosubscribed);
  this.on('subscribe', cb);
  if (this.got_subscribe) {
    cb(this.data); // eslint-disable-line callback-return
  }
};

// cb(data)
ClientChannelWorker.prototype.onceSubscribe = function (cb) {
  assert(this.subscriptions || this.autosubscribed);
  if (this.got_subscribe) {
    cb(this.data); // eslint-disable-line callback-return
  } else {
    this.once('subscribe', cb);
  }
};


ClientChannelWorker.prototype.handleChannelData = function (data, resp_func) {
  console.log(`got channel_data(${this.channel_id}):  ${JSON.stringify(data)}`);
  this.data = data;
  this.emit('channel_data', this.data);
  this.got_subscribe = true;
  this.emit('subscribe', this.data);
  resp_func();
};

ClientChannelWorker.prototype.handleApplyChannelData = function (data, resp_func) {
  // already logged in handleChannelMessage
  // if (!data.q) {
  //   console.log(`got channel data mod: ${JSON.stringify(data)}`);
  // }
  if (data.value === undefined) {
    dot_prop.delete(this.data, data.key);
  } else {
    dot_prop.set(this.data, data.key, data.value);
  }
  this.emit('channel_data', this.data, data.key, data.value);
  resp_func();
};

ClientChannelWorker.prototype.getChannelData = function (key, default_value) {
  return dot_prop.get(this.data, key, default_value);
};

ClientChannelWorker.prototype.setChannelData = function (key, value, skip_predict, resp_func) {
  if (!skip_predict) {
    dot_prop.set(this.data, key, value);
  }
  let q = value && value.q || undefined;
  this.subs.client.send('set_channel_data', { channel_id: this.channel_id, key, value, q }, resp_func);
};

ClientChannelWorker.prototype.removeMsgHandler = function (msg, cb) {
  assert(this.handlers[msg] === cb);
  delete this.handlers[msg];
};

ClientChannelWorker.prototype.onMsg = function (msg, cb) {
  assert(!this.handlers[msg] || this.handlers[msg] === cb);
  this.handlers[msg] = cb;
};

ClientChannelWorker.prototype.send = function (msg, data, opts, resp_func) {
  assert(typeof opts !== 'function');
  this.subs.client.send('channel_msg', {
    channel_id: this.channel_id,
    msg, data,
    broadcast: opts && opts.broadcast || undefined,
  }, resp_func);
};

function SubscriptionManager(client) {
  EventEmitter.call(this);
  this.client = client;
  this.channels = {};
  this.logged_in = false;
  this.login_credentials = null;
  this.logged_in_username = null;
  this.was_logged_in = false;
  this.logging_in = false;
  this.logging_out = false;

  this.first_connect = true;
  this.server_time = 0;
  client.onMsg('connect', this.handleConnect.bind(this));
  client.onMsg('channel_msg', this.handleChannelMessage.bind(this));
  client.onMsg('server_time', this.handleServerTime.bind(this));
  client.onMsg('admin_msg', this.handleAdminMsg.bind(this));
}
util.inherits(SubscriptionManager, EventEmitter);

SubscriptionManager.prototype.onceConnected = function (cb) {
  if (this.client.connected) {
    return void cb();
  }
  this.once('connect', cb);
};

SubscriptionManager.prototype.handleAdminMsg = function (data) {
  console.error(data);
  this.emit('admin_msg', data);
};

SubscriptionManager.prototype.handleConnect = function () {
  let reconnect = false;
  if (this.first_connect) {
    this.first_connect = false;
  } else {
    reconnect = true;
  }

  let subs = this;
  function resub() {
    // (re-)subscribe to all channels
    for (let channel_id in subs.channels) {
      let channel = subs.channels[channel_id];
      if (channel.subscriptions) {
        subs.client.send('subscribe', channel_id, function (err) {
          if (err) {
            channel.subscribe_failed = true;
            console.error(`Error subscribing to ${channel_id}: ${err}`);
            channel.emit('subscribe_fail', err);
          }
        });
      }
    }
    subs.emit('connect', reconnect);
  }

  if (this.was_logged_in) {
    // Try to re-connect to existing login
    this.loginInternal(this.login_credentials, function (err) {
      if (err && err === 'ERR_DISCONNECTED') {
        // we got disconnected while trying to log in, we'll retry after reconnection
      } else if (err) {
        // Error logging in upon re-connection, no good way to handle this?
        // TODO: Show some message to the user and prompt them to refresh?  Stay in "disconnected" state?
        assert(false);
      } else {
        resub();
      }
    });
  } else {
    // Try auto-login
    if (local_storage.get('name') && local_storage.get('password')) {
      this.login(local_storage.get('name'), local_storage.get('password'), function () {
        // ignore error on auto-login
      });
    }

    resub();
  }

};

SubscriptionManager.prototype.handleChannelMessage = function (data, resp_func) {
  if (!data.data || !data.data.q) {
    console.log(`got channel_msg(${data.channel_id}) ${data.msg}: ${JSON.stringify(data.data)}`);
  }
  let channel_id = data.channel_id;
  let msg = data.msg;
  data = data.data;
  let channel = this.getChannel(channel_id);
  if (!channel.handlers[msg]) {
    console.error(`no handler for channel_msg(${channel_id}) ${msg}: ${JSON.stringify(data)}`);
    return;
  }
  channel.handlers[msg](data, resp_func);
};

SubscriptionManager.prototype.handleServerTime = function (data) {
  this.server_time = data;
  if (this.server_time < this.server_time_interp && this.server_time > this.server_time_interp - 250) {
    // slight time travel backwards, this one packet must have been delayed,
    // since we once got a packet quicker. Just ignore this, interpolate from
    // where we were before
    // TODO: If the server had a short stall (less than 250ms) we might be
    // ahead from now on!  Slowly interp back to the specified time
    // (run speed at 90% until it matches?, same thing for catching up to
    // small jumps ahead)
  } else {
    this.server_time_interp = this.server_time;
  }
};

SubscriptionManager.prototype.getServerTime = function () {
  // Interpolated server time as of start of last tick
  return this.server_time_interp;
};

SubscriptionManager.prototype.tick = function (dt) {
  this.server_time_interp += dt;
};

SubscriptionManager.prototype.subscribe = function (channel_id) {
  this.getChannel(channel_id, true);
};

SubscriptionManager.prototype.getChannel = function (channel_id, do_subscribe) {
  let channel = this.channels[channel_id];
  if (!channel) {
    channel = this.channels[channel_id] = new ClientChannelWorker(this, channel_id);
  }
  if (do_subscribe) {
    channel.subscriptions++;
    if (this.client.connected && channel.subscriptions === 1) {
      channel.subscribe_failed = false;
      this.client.send('subscribe', channel_id, function (err) {
        if (err) {
          channel.subscribe_failed = true;
          console.error(`Error subscribing to ${channel_id}: ${err}`);
          channel.emit('subscribe_fail', err);
        }
      });
    }
  }
  return channel;
};

SubscriptionManager.prototype.getUserId = function () {
  return this.loggedIn();
};

SubscriptionManager.prototype.getMyUserChannel = function () {
  let user_id = this.loggedIn();
  if (!user_id) {
    return null;
  }
  let channel = this.getChannel(`user.${user_id}`);
  channel.autosubscribed = true;
  return channel;
};

SubscriptionManager.prototype.unsubscribe = function (channel_id) {
  let channel = this.channels[channel_id];
  assert(channel);
  assert(channel.subscriptions);
  channel.subscriptions--;
  if (!channel.subscriptions) {
    channel.got_subscribe = false;
  }
  if (this.client.connected && !channel.subscriptions && !channel.subscribe_failed) {
    this.client.send('unsubscribe', channel_id);
  }
};

SubscriptionManager.prototype.onLogin = function (cb) {
  this.getMyUserChannel();
  this.on('login', cb);
  if (this.logged_in) {
    return void cb();
  }
};

SubscriptionManager.prototype.loggedIn = function () {
  return this.logged_in ? this.logged_in_username || 'missing_name' : false;
};

SubscriptionManager.prototype.handleLoginResponse = function (resp_func, err, resp) {
  this.logging_in = false;
  if (!err) {
    this.logged_in_username = resp.user_id;
    this.logged_in_display_name = resp.display_name;
    this.logged_in = true;
    this.was_logged_in = true;
    this.emit('login');
  } else {
    this.emit('login_fail', err);
  }
  resp_func(err);
};

SubscriptionManager.prototype.loginInternal = function (login_credentials, resp_func) {
  if (this.logging_in) {
    return resp_func('Login already in progress');
  }
  this.logging_in = true;
  this.logged_in = false;
  return this.client.send('login', {
    user_id: login_credentials.user_id,
    password: md5(this.client.secret + login_credentials.password),
  }, this.handleLoginResponse.bind(this, resp_func));
};

SubscriptionManager.prototype.userCreateInternal = function (params, resp_func) {
  if (this.logging_in) {
    return resp_func('Login already in progress');
  }
  this.logging_in = true;
  this.logged_in = false;
  return this.client.send('user_create', params, this.handleLoginResponse.bind(this, resp_func));
};

function hashedPassword(user_id, password) {
  if (password.split('$$')[0] === 'prehashed') {
    password = password.split('$$')[1];
  } else {
    password = md5(md5(user_id.toLowerCase()) + password);
  }
  return password;
}


SubscriptionManager.prototype.login = function (username, password, resp_func) {
  if (!username) {
    return resp_func('Missing username');
  }
  if (!password) {
    return resp_func('Missing password');
  }
  let hashed_password = hashedPassword(username, password);
  if (hashed_password !== password) {
    local_storage.set('password', `prehashed$$${hashed_password}`);
  }
  this.login_credentials = { user_id: username, password: hashed_password };
  return this.loginInternal(this.login_credentials, resp_func);
};

SubscriptionManager.prototype.userCreate = function (params, resp_func) {
  if (!params.user_id) {
    return resp_func('Missing username');
  }
  if (!params.password) {
    return resp_func('Missing password');
  }
  if (!params.password_confirm) {
    return resp_func('Missing password confirmation');
  }
  if (!params.email) {
    return resp_func('Missing email');
  }
  let hashed_password = hashedPassword(params.user_id, params.password);
  if (hashed_password !== params.password) {
    local_storage.set('password', `prehashed$$${hashed_password}`);
  }
  let hashed_password_confirm = hashedPassword(params.user_id, params.password_confirm);
  if (hashed_password !== hashed_password_confirm) {
    return resp_func('Passwords do not match');
  }
  this.login_credentials = { user_id: params.user_id, password: hashed_password };
  return this.userCreateInternal({
    display_name: params.display_name || params.user_id,
    user_id: params.user_id,
    email: params.email,
    password: hashed_password,
  }, resp_func);
};


SubscriptionManager.prototype.logout = function () {
  assert(this.logged_in);
  assert(!this.logging_in);
  assert(!this.logging_out);
  // Don't know how to gracefully handle logging out with subscriptions currently, assert we have none
  for (let channel_id in this.channels) {
    let channel = this.channels[channel_id];
    assert(!channel.subscriptions);
    if (channel.autosubscribed) {
      channel.autosubscribed = false;
    }
  }

  this.logging_out = true;
  this.client.send('logout', null, (err) => {
    this.logging_out = false;
    if (!err) {
      local_storage.set('password', undefined);
      this.logged_in = false;
      this.logged_in_username = null;
      this.was_logged_in = false;
      this.login_credentials = null;
    }
  });
};

SubscriptionManager.prototype.sendCmdParse = function (command, resp_func) {
  let self = this;
  let channel_ids = Object.keys(self.channels);
  let idx = 0;
  let last_error = 'Unknown command';
  function tryNext() {
    let channel_id;
    let channel;
    do {
      channel_id = channel_ids[idx++];
      channel = self.channels[channel_id];
    } while (channel_id && (!channel || !(channel.subscriptions || channel.autosubscribed)));
    if (!channel_id) {
      return resp_func(last_error);
    }
    return channel.send('cmdparse', command, {},
      function (err, resp) {
        if (err || resp && resp.found) {
          return resp_func(err, resp ? resp.resp : null);
        }
        // otherwise, was not found
        if (resp && resp.err) {
          last_error = resp.err;
        }
        return self.onceConnected(tryNext);
      }
    );
  }
  self.onceConnected(tryNext);
};

export function create(client) {
  return new SubscriptionManager(client);
}
