// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const assert = require('assert');
const { logdata } = require('../../common/util.js');

export const ERR_NOT_FOUND = 'ERR_NOT_FOUND';

export const LOG_MESSAGES = false;

let queues = {};
let broadcasts = {};

// register as an authoritative single handler
// cb(src, message)
// register_cb(err) if already exists
export function register(id, cb, register_cb) {
  assert(id);
  assert(cb);
  assert(!queues[id]);
  queues[id] = cb;
  register_cb(null);
}

// subscribe to a broadcast-to-all channel
export function subscribe(id, cb) {
  broadcasts[id] = broadcasts[id] || [];
  broadcasts[id].push(cb);
}

export function unregister(id) {
  assert(queues[id]);
  delete queues[id];
}

// cb(err)
export function publish(src, dest, msg, cb) {
  if (LOG_MESSAGES) {
    console.debug(`exchange.publish ${src}->${dest}: ${
      msg.err ?
        `err:${msg.err}` :
        typeof msg.msg==='number' ?
          `ack(${msg.msg})` :
          msg.msg
    }${msg.pak_id ? `(${msg.pak_id})` : ''} ${logdata(msg.data)}`);
  }
  // Force this async, msg is *not* serialized upon call, so this can be super-fast in-process later
  process.nextTick(function () {
    if (broadcasts[dest]) {
      for (let ii = 0; ii < broadcasts[dest].length; ++ii) {
        broadcasts[dest][ii](src, msg);
      }
      return cb(null);
    }
    if (!queues[dest]) {
      return cb(ERR_NOT_FOUND);
    }
    queues[dest](src, msg);
    return cb(null);
  });
}
