/* eslint-env browser */

exports.storage_prefix = 'demo';

let local_storage_sim = {};
let lsd = (function () {
  try {
    localStorage.test = 'test';
    return localStorage;
  } catch (e) {
    return local_storage_sim;
  }
}());
export function get(key) {
  key = `${exports.storage_prefix}_${key}`;
  let ret = lsd[key];
  if (ret === 'undefined') {
    ret = undefined;
  }
  return ret;
}

export function set(key, value) {
  key = `${exports.storage_prefix}_${key}`;
  if (value === undefined || value === null) {
    delete lsd[key];
  } else {
    lsd[key] = value;
  }
}

export function setJSON(key, value) {
  set(key, JSON.stringify(value));
}

export function getJSON(key, def) {
  let value = get(key);
  try {
    return JSON.parse(value);
  } catch (e) {
    // ignore
  }
  return def;
}
