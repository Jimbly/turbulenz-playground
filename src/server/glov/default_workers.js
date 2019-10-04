// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const assert = require('assert');
const { ChannelWorker } = require('./channel_worker.js');
const md5 = require('../../common/md5.js');
const random_names = require('./random_names.js');

const email_regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function validDisplayName(display_name) {
  if (!display_name) {
    return false;
  }
  return true;
}

export class DefaultUserWorker extends ChannelWorker {
  constructor(channel_server, channel_id) {
    super(channel_server, channel_id);
    this.user_id = this.channel_subid; // 1234
  }
  cmdRename(new_name, resp_func) {
    if (!new_name) {
      return resp_func('Missing name');
    }
    this.setChannelData('public.display_name', new_name);
    return resp_func(null, 'Successfully renamed');
  }
  cmdRenameRandom(ignored, resp_func) {
    return this.cmdRename(random_names.get(), resp_func);
  }
  handleLogin(src, data, resp_func) {
    if (!data.password) {
      return resp_func('Missing password');
    }

    if (!this.getChannelData('private.password')) {
      return resp_func('ERR_USER_NOT_FOUND');
    }
    if (md5(data.salt + this.getChannelData('private.password')) !== data.password) {
      return resp_func('Invalid password');
    }
    this.setChannelData('private.login_ip', data.ip);
    this.setChannelData('private.login_time', Date.now());
    return resp_func(null, this.getChannelData('public'));
  }
  handleCreate(src, data, resp_func) {
    if (this.getChannelData('private.password')) {
      return resp_func('Account already exists');
    }
    if (!data.password) {
      return resp_func('Missing password');
    }
    if (!email_regex.test(data.email)) {
      return resp_func('Email invalid');
    }
    if (!validDisplayName(data.display_name)) {
      return resp_func('Invalid display name');
    }

    this.setChannelData('private.password', data.password);
    this.setChannelData('public.display_name', data.display_name);
    this.setChannelData('private.email', data.email);
    this.setChannelData('private.creation_ip', data.ip);
    this.setChannelData('private.creation_time', Date.now());
    this.setChannelData('private.login_ip', data.ip);
    this.setChannelData('private.login_time', Date.now());
    return resp_func(null, this.getChannelData('public'));
  }
  handleSetChannelData(src, key, value) {
    if (!this.defaultHandleSetChannelData(src, key, value)) {
      return false;
    }
    assert(src);
    assert(src.type);
    if (src.type !== 'client') {
      // from another channel, accept it
      return true;
    }
    // Only allow changes from own client!
    if (src.user_id !== this.user_id) {
      return false;
    }
    return true;
  }
}
DefaultUserWorker.prototype.auto_destroy = true;

class ChannelServerWorker extends ChannelWorker {
  handleWorkerRemoved(src, data, resp_func) {
    assert(!resp_func.expecting_response); // this is a broadcast
    this.channel_server.handleWorkerRemoved(data);
  }
}

let inited = false;
let user_worker = DefaultUserWorker;
let user_worker_init_data = {
  autocreate: true,
  cmds: {
    rename: DefaultUserWorker.prototype.cmdRename,
    rename_random: DefaultUserWorker.prototype.cmdRenameRandom,
  },
  handlers: {
    login: DefaultUserWorker.prototype.handleLogin,
    create: DefaultUserWorker.prototype.handleCreate,
  },
};
export function overrideUserWorker(new_user_worker, extra_data) {
  assert(!inited);
  user_worker = new_user_worker;
  for (let key in extra_data) {
    let v = extra_data[key];
    if (typeof v === 'object') {
      let dest = user_worker_init_data[key] = user_worker_init_data[key] || {};
      for (let subkey in v) {
        dest[subkey] = v[subkey];
      }
    } else {
      user_worker_init_data[key] = v;
    }
  }
}

export function init(channel_server) {
  inited = true;
  channel_server.registerChannelWorker('user', user_worker, user_worker_init_data);
  channel_server.registerChannelWorker('channel_server', ChannelServerWorker, {
    autocreate: false,
    handlers: {
      worker_removed: ChannelServerWorker.prototype.handleWorkerRemoved,
    },
  });
}
