const ack = require('../../common/ack.js');
const assert = require('assert');
const { channelServerSend } = require('./channel_server.js');
const dot_prop = require('dot-prop');
const exchange = require('./exchange.js');
const { min } = Math;
const { empty, logdata } = require('../../common/util.js');

// How long to wait before failing an out of order packet and running it anyway
const OOO_PACKET_FAIL = 10000; // For testing this, disable channel_server.js:handleWorkerRemoved
const AUTO_DESTROY_TIME = 90000;

function throwErr(err) {
  if (err) {
    throw err;
  }
}

const PKT_LOG_SIZE = 16;


export class ChannelWorker {
  constructor(channel_server, channel_id) {
    this.channel_server = channel_server;
    this.channel_id = channel_id;
    let m = channel_id.match(/^([^.]*)\.(.*)$/); // eslint-disable-line require-unicode-regexp
    assert(m);
    this.channel_type = m[1];
    this.channel_subid = m[2];
    this.ids = null; // Any extra IDs that get send along with every packet
    this.core_ids = {
      type: this.channel_type,
      id: this.channel_subid,
      channel_id,
    };
    this.send_pkt_idx = {}; // for each destination, the last ordering ID we sent
    this.recv_pkt_idx = {}; // for each source, the last ordering ID we received
    this.pkt_queue = {}; // for each source, any queued packets that need to be dispatched in order
    this.subscribers = []; // ids of who is subscribed to us
    this.store_path = `${this.channel_type}/${this.channel_id}`;
    this.bulk_store_path = `bulk/${this.channel_type}/${this.channel_id}`;
    this.bulk_store_paths = {};
    this.data = channel_server.ds_store.get(this.store_path, '', {});
    this.data.public = this.data.public || {};
    this.data.private = this.data.private || {};
    this.subscribe_counts = {}; // refcount of subscriptions to other channels
    this.is_channel_worker = true; // TODO: Remove this?
    this.adding_client = null; // The client we're in the middle of adding, don't send them state updates yet
    this.last_msg_time = Date.now();
    ack.initReceiver(this);
    // Handle modes that can be enabled via statics on prototype
    if (this.maintain_client_list) {
      this.data.public.clients = {};
    }

    this.pkt_log_idx = 0;
    this.pkt_log = new Array(PKT_LOG_SIZE);
  }

  shutdown() {
    assert(!this.numSubscribers());
    assert(empty(this.subscribe_counts));
    // TODO: this unloading should be automatic / in lower layer, as it doesn't
    // make sense when the datastore is a database?
    this.channel_server.ds_store.unload(this.store_path);
    for (let path in this.bulk_store_paths) {
      this.channel_server.ds_store.unload(path);
    }
    this.channel_server.removeChannelLocal(this.channel_id);
  }

  numSubscribers() {
    return this.subscribers.length;
  }

  onSubscribe(src, data, resp_func) {
    let { channel_id, user_id } = src;
    let is_client = src.type === 'client';

    if (is_client && this.require_login && !user_id) {
      return resp_func('ERR_LOGIN_REQUIRED');
    }

    this.subscribers.push(channel_id);
    this.adding_client = channel_id;

    let err = this.handleNewClient && this.handleNewClient(src);
    if (err) {
      this.adding_client = null;
      // not allowed, undo
      this.subscribers.pop();
      return resp_func(typeof err === 'string' ? err : 'ERR_NOT_ALLOWED_BY_WORKER');
    }

    let ids;
    if ((this.emit_join_leave_events || this.maintain_client_list) && is_client) {
      // Clone, not reference, we need to know the old user id for unsubscribing!
      // Also, just need these 3 ids
      ids = {
        user_id,
        client_id: src.id,
        display_name: src.display_name,
      };
    }

    if (this.emit_join_leave_events && is_client) {
      this.channelEmit('join', ids);
    }

    if (this.maintain_client_list && is_client) {
      this.setChannelData(`public.clients.${src.id}.ids`, ids);
      if (user_id) {
        this.subscribeOther(`user.${user_id}`);
      }
    }

    this.adding_client = null;

    // 'channel_data' is really an ack for 'subscribe' - sent exactly once
    this.sendChannelMessage(channel_id, 'channel_data', {
      public: this.data.public,
    });
    return resp_func();
  }

  isEmpty() {
    return !this.subscribers.length && empty(this.pkt_queue);
  }

  autoDestroyCheck() {
    assert(this.auto_destroy_check);
    if (!this.isEmpty()) {
      this.auto_destroy_check = false;
      // have a subscriber now, forget about it
      return;
    }
    if (Date.now() - this.last_msg_time > AUTO_DESTROY_TIME) {
      this.auto_destroy_check = false;
      console.info(`${this.channel_id}: Empty time expired, auto-destroying...`);
      this.shutdown();
      return;
    }
    // Continue checking
    setTimeout(this.autoDestroyCheck.bind(this), AUTO_DESTROY_TIME);
  }

  checkAutoDestroy() {
    this.last_msg_time = Date.now();
    if (this.auto_destroy && !this.auto_destroy_check && this.isEmpty()) {
      this.auto_destroy_check = true;
      setTimeout(this.autoDestroyCheck.bind(this), AUTO_DESTROY_TIME);
    }
  }

  onUnSubscribe(src, data, resp_func) {
    let { channel_id, user_id } = src;
    let is_client = src.type === 'client';
    let idx = this.subscribers.indexOf(channel_id);
    if (idx === -1) {
      // This can happen if a client is unsubscribing before it got the message
      // back saying its subscription attempt failed
      return void resp_func('ERR_NOT_SUBSCRIBED');
    }
    this.subscribers.splice(idx, 1);
    if (this.handleClientDisconnect) {
      this.handleClientDisconnect(src);
    }
    if (this.emit_join_leave_events && is_client) {
      this.channelEmit('leave', src);
    }

    if (this.maintain_client_list && is_client) {
      this.setChannelData(`public.clients.${src.id}`, undefined);
      if (user_id) {
        this.unsubscribeOther(`user.${user_id}`);
      }
    }
    resp_func();
    this.checkAutoDestroy();
  }

  isSubscribedTo(other_channel_id) {
    return this.subscribe_counts[other_channel_id];
  }

  subscribeOther(other_channel_id, resp_func) {
    this.subscribe_counts[other_channel_id] = (this.subscribe_counts[other_channel_id] || 0) + 1;
    if (this.subscribe_counts[other_channel_id] !== 1) {
      console.debug(`${this.channel_id}->${other_channel_id}: subscribe - already subscribed`);
      return;
    }
    this.sendChannelMessage(other_channel_id, 'subscribe', undefined, (err, resp_data) => {
      if (err) {
        console.log(`${this.channel_id}->${other_channel_id} subscribe failed: ${err}`);
        this.subscribe_counts[other_channel_id]--;
        if (!this.subscribe_counts[other_channel_id]) {
          delete this.subscribe_counts[other_channel_id];
        }
        if (resp_func) {
          resp_func(err);
        } else {
          this.onError(err);
        }
      } else {
        // succeeded, nothing special
        if (resp_func) {
          resp_func();
        }
      }
    });
  }
  unsubscribeOther(other_channel_id) {
    assert(this.channel_type === 'client' || this.subscribe_counts[other_channel_id]);
    if (!this.subscribe_counts[other_channel_id]) {
      console.log(`${this.channel_id}->${other_channel_id}: unsubscribe - failed: not subscribed`);
      return;
    }
    --this.subscribe_counts[other_channel_id];
    if (this.subscribe_counts[other_channel_id]) {
      console.debug(`${this.channel_id}->${other_channel_id}: unsubscribe - still subscribed (refcount)`);
      return;
    }

    delete this.subscribe_counts[other_channel_id];
    // TODO: Disable autocreate for this call?
    this.sendChannelMessage(other_channel_id, 'unsubscribe', undefined, (err, resp_data) => {
      if (err === exchange.ERR_NOT_FOUND) {
        // This is fine, just ignore
        console.debug(`${this.channel_id}->${other_channel_id} unsubscribe (silently) failed: ${err}`);
      } else if (err) {
        console.error(`${this.channel_id}->${other_channel_id} unsubscribe failed: ${err}`);
        this.onError(err);
      } else {
        // succeeded, nothing special
      }
    });
  }
  unsubscribeAll() {
    for (let channel_id in this.subscribe_counts) {
      let count = this.subscribe_counts[channel_id];
      for (let ii = 0; ii < count; ++ii) {
        this.unsubscribeOther(channel_id);
      }
    }
  }
  onClientChanged(src, data, resp_func) {
    let { user_id } = src;
    let client_id = src.id;
    let is_client = src.type === 'client';
    assert(is_client);
    if (this.handleClientChanged) {
      this.handleClientChanged(src);
    }
    if (this.maintain_client_list && is_client && this.data.public.clients[client_id]) {
      let old_ids = this.data.public.clients[client_id].ids || {};
      if (old_ids.user_id !== user_id) {
        if (old_ids.user_id) {
          this.unsubscribeOther(`user.${old_ids.user_id}`);
        }
        if (user_id) {
          this.subscribeOther(`user.${user_id}`);
        }
      }
      this.setChannelData(`public.clients.${client_id}.ids`, {
        user_id,
        client_id,
        display_name: src.display_name,
      });
    }
    resp_func();
  }

  // data is a { key, value } pair of what has changed
  onApplyChannelData(source, data) {
    if (this.maintain_client_list) {
      if (source.type === 'user' && data.key === 'public.display_name') {
        for (let client_id in this.data.public.clients) {
          let client_ids = this.data.public.clients[client_id].ids;
          if (client_ids && client_ids.user_id === source.id) {
            this.setChannelData(`public.clients.${client_id}.ids.display_name`, data.value);
          }
        }
      }
    }
  }

  // data is the channel's entire (public) data sent in response to a subscribe
  onChannelData(source, data) {
    if (this.maintain_client_list) {
      if (source.type === 'user' && data.public.display_name) {
        for (let client_id in this.data.public.clients) {
          let client_ids = this.data.public.clients[client_id].ids;
          if (client_ids && client_ids.user_id === source.id) {
            this.setChannelData(`public.clients.${client_id}.ids.display_name`, data.public.display_name);
          }
        }
      }
    }
  }

  onBroadcast(source, data, resp_func) {
    if (typeof data !== 'object' || typeof data.data !== 'object' || typeof data.msg !== 'string') {
      return resp_func('ERR_INVALID_DATA');
    }
    if (source.type === 'client') {
      if (this.allow_client_broadcast[data.msg] !== true) {
        return resp_func('ERR_NOT_ALLOWED');
      }
    }
    if (data.err) { // From a filter
      return resp_func(data.err);
    }
    // Replicate to all users
    data.data.client_ids = source;
    this.channelEmit(data.msg, data.data);
    return resp_func();
  }

  onCmdParse(source, data, resp_func) {
    this.cmd_parse_source = source;
    this.cmd_parse.handle(this, data, (err, resp) => {
      if (err && this.cmd_parse.was_not_found) {
        return resp_func(null, { found: 0, err });
      }
      return resp_func(err, { found: 1, resp });
    });
  }

  channelEmit(msg, data, except_client) {
    let count = 0;
    let was_q = false;
    if (typeof data === 'object') {
      was_q = data.q;
      data.q = 1;
    }
    for (let ii = 0; ii < this.subscribers.length; ++ii) {
      if (this.subscribers[ii] === except_client) {
        continue;
      }
      ++count;
      this.sendChannelMessage(this.subscribers[ii], msg, data);
    }
    if (count && !was_q) {
      console.debug(`${this.channel_id}->broadcast(${count}): ${msg} ${logdata(data)}`);
    }
  }

  onSetChannelDataIf(source, data, resp_func) {
    if (source.type === 'client') {
      // deny
      return resp_func('ERR_NOT_ALLOWED');
    }
    let old_value = dot_prop.get(this.data, data.key);
    if (old_value !== data.set_if) {
      return resp_func('ERR_SETIF_MISMATCH');
    }
    this.setChannelDataInternal(source, data.key, data.value, data.q);
    return resp_func();
  }

  commitData() {
    let data = this.data;
    if (this.maintain_client_list) {
      data = {};
      for (let key in this.data) {
        data[key] = this.data[key];
      }
      let public_data = data.public;
      assert(public_data);
      let pd = {};
      for (let key in public_data) {
        if (key !== 'clients') {
          pd[key] = public_data[key];
        }
      }
      data.public = pd;
    }
    this.channel_server.ds_store.set(this.store_path, '', data);
    if (this.maintain_client_list) {
      // Also do some verification to track down a bug
      // 2019-10-01 I believe this bug is fixed now
      let public_data = this.data.public;
      assert(public_data);
      assert(public_data.clients);
      for (let client_id in public_data.clients) {
        let client = this.data.public.clients[client_id];
        assert(client);
        let client_ids = client.ids;
        if (!client_ids) {
          // do this as a full error with a dump exactly once
          if (this.HACK_did_error) {
            console.log(`Missing .ids for client ${client_id}`);
          } else {
            this.channel_server.handleUncaughtError(`Missing .ids for client ${client_id}`);
            this.HACK_did_error = true;
          }
        }
      }
    }
  }

  onSetChannelDataPush(source, data, resp_func) {
    let { key, value } = data;
    assert(typeof key === 'string');
    assert(typeof source === 'object');
    if (this.handleSetChannelData ?
      !this.handleSetChannelData(source, key, value) :
      !this.defaultHandleSetChannelData(source, key, value)
    ) {
      // denied by app_worker
      console.log(`set_channel_data_push on ${key} from ${source.channel_id} failed handleSetChannelData() check`);
      return resp_func('ERR_APP_WORKER');
    }
    assert(value);
    let arr = dot_prop.get(this.data, key);
    let need_create = !arr;
    if (need_create) {
      arr = [];
    }
    if (!Array.isArray(arr)) {
      return resp_func('ERR_NOT_ARRAY');
    }

    let idx = arr.push(value) - 1;
    if (need_create) {
      dot_prop.set(this.data, key, arr);
    } else {
      // array was modified in-place
    }
    // only send public changes
    if (key.startsWith('public')) {
      let mod_data;
      if (need_create) {
        mod_data = { key, value: arr };
      } else {
        mod_data = { key: `${key}.${idx}`, value };
      }
      this.channelEmit('apply_channel_data', mod_data, this.adding_client);
    }
    this.commitData();
    return resp_func();
  }

  onSetChannelData(source, data) {
    this.setChannelDataInternal(source, data.key, data.value, data.q);
  }
  setChannelData(key, value, q) {
    this.setChannelDataInternal(this.core_ids, key, value, q);
  }

  onGetChannelData(source, data, resp_func) {
    // Do not deny this here, this is handled by RESERVED in client_comm.js
    // We want the client_comm functions to send this message if needed.
    // if (source.type === 'client') {
    //   // deny
    //   return resp_func('ERR_NOT_ALLOWED');
    // }
    return resp_func(null, this.getChannelData(data));
  }

  defaultHandleSetChannelData(source, key, value) { // eslint-disable-line class-methods-use-this
    if (source.type !== 'client' || !source.direct) {
      // from another channel, or not directly from the user, accept it
      return true;
    }
    // Do not allow modifying of other users' client data
    if (key.startsWith('public.clients.')) {
      if (!key.startsWith(`public.clients.${source.id}.`)) {
        return false;
      }
      // Do not allow modifying of clients that do not exist
      if (!this.data.public.clients[source.id]) {
        return false;
      }
      return true;
    }
    return this.permissive_client_set; // default false - don't let clients change anything other than their own data
  }

  setChannelDataInternal(source, key, value, q) {
    assert(typeof key === 'string');
    assert(typeof source === 'object');
    if (this.handleSetChannelData ?
      !this.handleSetChannelData(source, key, value) :
      !this.defaultHandleSetChannelData(source, key, value)
    ) {
      // denied by app_worker
      console.log(`setChannelData on ${key} from ${source.channel_id} failed handleSetChannelData() check`);
      return;
    }

    if (value === undefined) {
      dot_prop.delete(this.data, key);
    } else {
      dot_prop.set(this.data, key, value);
    }
    // only send public changes
    if (key.startsWith('public')) {
      let data = { key, value };
      if (q) {
        data.q = 1;
      }
      this.channelEmit('apply_channel_data', data, this.adding_client);
    }
    this.commitData();
  }
  getChannelData(key, default_value) {
    return dot_prop.get(this.data, key, default_value);
  }

  getBulkChannelData(obj_name, key, default_value, cb) {
    let bulk_obj_name = `${this.bulk_store_path}/${obj_name}`;
    this.bulk_store_paths[bulk_obj_name] = true;
    this.channel_server.ds_store.getAsync(bulk_obj_name, key, default_value, cb);
  }
  setBulkChannelData(obj_name, key, value, cb) {
    let bulk_obj_name = `${this.bulk_store_path}/${obj_name}`;
    this.bulk_store_paths[bulk_obj_name] = true;
    this.channel_server.ds_store.setAsync(bulk_obj_name, key, value, cb || throwErr);
  }

  sendChannelMessage(dest, msg, data, resp_func) {
    channelServerSend(this, dest, msg, null, data, resp_func);
  }

  // source has at least { channel_id, type, id }, possibly also .user_id and .display_name if type === 'client'
  channelMessage(source, msg, data, resp_func) {
    if (source.direct) {
      // Ensure this is allowed directly from clients
      if (!this.allow_client_direct[msg]) {
        return void resp_func(`ERR_CLIENT_DIRECT (${msg})`);
      }
    }
    let had_handler = false;
    assert(resp_func);
    if (this.filters[msg]) {
      this.filters[msg].call(this, source, data);
      had_handler = true;
    }
    if (this.handlers[msg]) {
      this.handlers[msg].call(this, source, data, resp_func);
    } else if (this.onUnhandledMessage) {
      this.onUnhandledMessage(source, msg, data, resp_func);
    } else {
      // No use handler for this message
      if (had_handler) {
        // But, we had a filter (probably something internal) that dealt with it, silently continue;
        resp_func();
      } else {
        resp_func(`No handler registered for '${msg}'`);
      }
    }
  }

  onError(msg) {
    console.error(`ChannelWorker(${this.channel_id}) error:`, msg);
  }

  // Default error handler
  handleError(src, data, resp_func) {
    this.onError(`Unhandled error from ${src.type}.${src.id}: ${data}`);
    resp_func();
  }

  checkPacketQueue(source) {
    let q_data = this.pkt_queue[source];
    if (!q_data) {
      return;
    }
    let q = q_data.pkts;
    let next_idx = (this.recv_pkt_idx[source] || 0) + 1;
    let next = q[next_idx];
    if (next) {
      // Next one is ready to go now!
      console.error(`${this.channel_id}: Delayed dispatching OOO packet with ID ${next_idx} from ${source}.`);
      delete q[next_idx];
      if (empty(q)) {
        if (q_data.tid) {
          clearTimeout(q_data.tid);
        }
        delete this.pkt_queue[source];
      }
      // TODO: Make this not deeply recursive?
      this.dispatchPacket(next_idx, next.source, next.ids, next.net_data);
    }
  }

  startPacketQueueCheck(source) {
    let q_data = this.pkt_queue[source];
    assert(q_data);
    assert(!q_data.tid);
    q_data.tid = setTimeout(this.checkPacketQueueTimeout.bind(this, source), OOO_PACKET_FAIL);
    // Could also send a ping here and fulfill this timeout when it comes back, but
    // a ping is not guaranteed to arrive after all packets, since if there
    // are multiple sources sending packets, one (that does not do the create)
    // may still be trying to resend the initial packet (waiting on their (going
    // to fail) create to finish) when the ping makes it. Could send a more
    // complicated "request for flush to target" that doesn't return until all
    // retries are sent, and that would do it.
  }

  checkPacketQueueTimeout(source) {
    let q_data = this.pkt_queue[source];
    q_data.tid = null;
    let q = q_data.pkts;
    assert(!empty(q));
    let oldest_pkt_id = Infinity;
    for (let pkt_id in q) {
      oldest_pkt_id = min(oldest_pkt_id, Number(pkt_id));
    }
    let next_idx = oldest_pkt_id;
    let expected_idx = (this.recv_pkt_idx[source] || 0) + 1;
    let next = q[next_idx];
    console.error(`${this.channel_id}: Time expired. Running queued OOO packet with ID ${
      next_idx} (expected ${expected_idx}) from ${source}.`);
    delete q[next_idx];
    if (empty(q)) {
      delete this.pkt_queue[source];
    }
    this.dispatchPacket(next_idx, next.source, next.ids, next.net_data);
    // also dispatches any sequential queued up, and may clear/invalidate q_data
    if (this.pkt_queue[source]) {
      // still have remaining, non-sequential packets (untested, unexpected)
      console.error(`${this.channel_id}: Still remaining packets from ${source}. Queuing...`);
      this.startPacketQueueCheck(source);
    }
  }

  dispatchPacket(pkt_idx, source, ids, net_data) {
    let channel_worker = this;
    channel_worker.logPacketDispatch(source, net_data);
    channel_worker.channel_server.last_worker = channel_worker;
    channel_worker.recv_pkt_idx[source] = pkt_idx;
    try {
      ack.handleMessage(channel_worker, source, net_data, function sendFunc(msg, err, data, resp_func) {
        channelServerSend(channel_worker, source, msg, err, data, resp_func);
      }, function handleFunc(msg, data, resp_func) {
        channel_worker.channelMessage(ids, msg, data, resp_func);
      });
    } catch (e) {
      e.source = source;
      console.error(`Exception while handling packet from "${source}"`);
      channel_worker.channel_server.handleUncaughtError(e);
    }
    this.checkPacketQueue(source);
  }

  // source is a string channel_id
  handleMessage(source, net_data) {
    let channel_worker = this;
    let ids = net_data.ids || {};
    let split = source.split('.');
    assert(split.length === 2);
    ids.type = split[0];
    ids.id = split[1];
    ids.channel_id = source;
    let pkt_idx = net_data.pkt_idx;
    assert(pkt_idx);
    let expected_idx = (this.recv_pkt_idx[source] || 0) + 1;
    function dispatch() {
      channel_worker.dispatchPacket(pkt_idx, source, ids, net_data);
    }
    if (pkt_idx === expected_idx) {
      dispatch();
    } else if (pkt_idx === 1) {
      console.error(`${channel_worker.channel_id}: Received new initial packet with ID ${pkt_idx
      } (expected >=${expected_idx}) from ${source}. Dispatching...`);
      dispatch();
    } else {
      console.error(`${channel_worker.channel_id}: Received OOO packet with ID ${pkt_idx
      } (expected ${expected_idx}) from ${source}. Queuing...`);
      let q_data = channel_worker.pkt_queue[source] = channel_worker.pkt_queue[source] || { pkts: {} };
      q_data.pkts[pkt_idx] = { source, ids, net_data };
      if (!q_data.tid) {
        this.startPacketQueueCheck(source);
      }
    }
    this.checkAutoDestroy();
  }

  logPacketDispatch(source, net_data) {
    this.pkt_log[this.pkt_log_idx] = { ts: Date.now(), source, net_data };
    this.pkt_log_idx = (this.pkt_log_idx + 1) % PKT_LOG_SIZE;
  }
}
// Overrideable by child class's prototype
ChannelWorker.prototype.maintain_client_list = false;
ChannelWorker.prototype.emit_join_leave_events = false;
ChannelWorker.prototype.require_login = false;
ChannelWorker.prototype.auto_destroy = false;
ChannelWorker.prototype.permissive_client_set = false; // allow clients to set arbitrary data
ChannelWorker.prototype.allow_client_broadcast = {}; // default: none
ChannelWorker.prototype.allow_client_direct = {}; // default: none; but use client_handlers to more easily fill this
