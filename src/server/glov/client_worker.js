// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const assert = require('assert');
const { ChannelWorker } = require('./channel_worker.js');

class ClientWorker extends ChannelWorker {
  constructor(channel_server, channel_id) {
    super(channel_server, channel_id);
    this.client_id = this.channel_subid; // 1234
    this.client = null; // WSClient filled in by channel_server
    this.ids_base = {
      user_id: undefined,
      display_name: channel_id,
      direct: undefined, // so it is iterated
    };
    this.ids_direct = new Proxy(this.ids_base, {
      get: function (target, prop) {
        if (prop === 'direct') {
          return true;
        }
        return target[prop];
      }
    });
    this.ids = this.ids_base;
  }

  onApplyChannelData(source, data) {
    if (!this.ids.user_id) {
      // not logged in yet
      return;
    }
    if (source.type !== 'user' || source.id !== this.ids.user_id) {
      // not about our user
      return;
    }
    if (data.key === 'public.display_name') {
      this.ids_base.display_name = data.value;
    }
  }

  onForceKick(source, data) {
    assert(this.client.connected);
    this.client.ws_server.disconnectClient(this.client);
  }

  onUnhandledMessage(source, msg, data, resp_func) {
    assert(this.client);
    if (!resp_func.expecting_response) {
      resp_func = null;
    }

    if (!this.client.connected) {
      if (resp_func) {
        console.debug(`ClientWorker(${this.channel_id}) received message for disconnected client:`, msg);
        return void resp_func('ERR_CLIENT_DISCONNECTED');
      }
    }

    this.client.send('channel_msg', {
      channel_id: source.channel_id,
      msg: msg,
      data: data,
    }, resp_func);
  }

  onError(msg) {
    console.error(`ClientWorker(${this.channel_id}) error:`, msg);
    this.client.send('error', msg);
  }
}

export function init(channel_server) {
  channel_server.registerChannelWorker('client', ClientWorker, {
    autocreate: false,
    filters: {
      'apply_channel_data': ClientWorker.prototype.onApplyChannelData,
    },
    handlers: {
      'force_kick': ClientWorker.prototype.onForceKick,
    },
  });
}
