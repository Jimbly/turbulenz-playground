// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

/*
  API usage:
  engine.defines = urlhash.register({
    key: 'D',
    type: SET,
  });
  urlhash.register({
    key: 'pos',
    // type: TYPE_STRING,
    change: (newvalue) => {}
    def: '1,2'
  });
  urlhash.set('pos', '3,4');
  urlhash.get('pos')
*/

const assert = require('assert');

const HISTORY_UPDATE_TIME = 1000;

export let TYPE_SET = 'set';
export let TYPE_STRING = 'string';

let params = {};

const regex_value = /[^\w]\w+=([^&]+)/u;
function getValue(opts) {
  let m = (document.location.hash || '').match(opts.regex) || [];
  if (opts.type === TYPE_SET) {
    let r = {};
    for (let ii = 0; ii < m.length; ++ii) {
      let m2 = m[ii].match(regex_value);
      assert(m2);
      r[m2[1]] = 1;
    }
    return r;
  } else {
    return m[1] || opts.def;
  }
}

function onPopState() {
  // Update all values
  let dirty = {};
  for (let key in params) {
    let opts = params[key];
    let new_value = getValue(opts);
    if (opts.type === TYPE_SET) {
      for (let v in new_value) {
        if (!opts.value[v]) {
          opts.value[v] = 1;
          dirty[key] = true;
        }
      }
      for (let v in opts.value) {
        if (!new_value[v]) {
          delete opts.value[v];
          dirty[key] = true;
        }
      }
    } else {
      if (new_value !== opts.value) {
        dirty[key] = true;
        opts.value = new_value;
      }
    }
  }

  // Call all change callbacks
  for (let key in dirty) {
    let opts = params[key];
    if (opts.change) {
      opts.change(opts.value);
    }
  }
}

function toString() {
  let values = [];
  for (let key in params) {
    let opts = params[key];
    if (opts.type === TYPE_SET) {
      for (let v in opts.value) {
        values.push(`${key}=${v}`);
      }
    } else {
      if (opts.value !== opts.def) {
        values.push(`${key}=${opts.value}`);
      }
    }
  }
  return values.join('&');
}

let last_history_str = null; // always re-set it on the first update
let last_history_set_time = 0;
let scheduled = false;
// const URL_BASE = document.location.href.match(/^[^#]+/u)[0];
function updateHistory() {
  let new_str = toString();
  if (last_history_str === new_str) {
    return;
  }
  last_history_str = new_str;
  if (scheduled) {
    // already queued up
    return;
  }
  let delay = HISTORY_UPDATE_TIME;
  if (Date.now() - last_history_set_time > HISTORY_UPDATE_TIME) {
    // Been awhile, apply "instantly" (but still wait until next tick to ensure
    //   any other immediate changes are registered)
    delay = 1;
  }
  scheduled = true;
  setTimeout(function () {
    scheduled = false;
    last_history_set_time = Date.now();
    // window.history.replaceState('', HISTORY_TITLE, `${URL_BASE}#${last_history_str}`);
    window.history.replaceState(undefined, undefined, `#${last_history_str}`);
  }, delay);
}


export function register(opts) {
  assert(opts.key);
  assert(!params[opts.key]);
  opts.type = opts.type || TYPE_STRING;
  let regex_search = `(?:[^\\w])${opts.key}=([^&]+)`;
  let regex_type = 'u';
  if (opts.type === TYPE_SET) {
    regex_type = 'gu';
  } else {
    opts.def = opts.def || '';
  }
  opts.regex = new RegExp(regex_search, regex_type);
  params[opts.key] = opts;
  // Get initial value
  opts.value = getValue(opts);
  let ret = opts.value;
  if (opts.type === TYPE_SET && typeof Proxy === 'function') {
    // Auto-apply changes to URL if someone modifies the proxy
    ret = new Proxy(opts.value, {
      set: function (target, prop, value) {
        if (value) {
          target[prop] = 1;
        } else {
          delete target[prop];
        }
        updateHistory();
        return true;
      }
    });
  }

  if (!window.onpopstate) {
    window.onpopstate = onPopState;
  }

  return ret;
}

export function set(key, value) {
  let opts = params[key];
  assert(opts);
  if (opts.value !== value) {
    opts.value = value;
    updateHistory();
  }
}

export function get(key) {
  let opts = params[key];
  assert(opts);
  return opts.value;
}
