// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const assert = require('assert');
const dot_prop = require('dot-prop');
const FileStore = require('fs-store').FileStore;
const mkdirp = require('mkdirp');
const path = require('path');

class DataStoreOneFile {
  constructor(store_path) {
    this.root_store = new FileStore(store_path);
  }
  set(obj_name, key, value) {
    let obj = this.root_store.get(obj_name, {});
    if (!key) {
      obj = value;
    } else {
      dot_prop.set(obj, key, value);
    }
    this.root_store.set(obj_name, obj);
  }
  get(obj_name, key, default_value) {
    let obj = this.root_store.get(obj_name, key ? {} : default_value);
    if (!key) {
      return obj;
    }
    return dot_prop.get(obj, key, default_value);
  }
  setAsync(obj_name, key, value, cb) {
    setImmediate(() => {
      this.set(obj_name, key, value);
      cb();
    });
  }
  getAsync(obj_name, key, default_value, cb) {
    setImmediate(() => {
      cb(null, this.get(obj_name, key, default_value));
    });
  }
  unload(obj_name) { // eslint-disable-line class-methods-use-this
    // doing nothing, as we're not loading individualf iles
  }
}

class DataStore {
  constructor(store_path) {
    this.path = store_path;
    this.stores = {};
    this.mkdirs = {};
    this.mkdir(store_path);
  }
  mkdir(store_path) {
    if (this.mkdirs[store_path]) {
      return;
    }
    mkdirp.sync(store_path);
    this.mkdirs[store_path] = true;
  }
  getStore(obj_name) {
    let store = this.stores[obj_name];
    if (!store) {
      let store_path = path.join(this.path, `${obj_name}.json`);
      this.mkdir(path.dirname(store_path));
      store = this.stores[obj_name] = new FileStore(store_path);
    }
    return store;
  }
  unload(obj_name) {
    let store = this.stores[obj_name];
    assert(store);
    delete this.stores[obj_name];
  }
  set(obj_name, key, value) {
    let store = this.getStore(obj_name);
    let obj = store.get('data', {});
    if (!key) {
      obj = value;
    } else {
      dot_prop.set(obj, key, value);
    }
    store.set('data', obj);
  }
  get(obj_name, key, default_value) {
    let store = this.getStore(obj_name);
    let obj = store.get('data', key ? {} : default_value);
    if (!key) {
      return obj;
    }
    return dot_prop.get(obj, key, default_value);
  }

  setAsync(obj_name, key, value, cb) {
    setImmediate(() => {
      this.set(obj_name, key, value);
      cb();
    });
  }
  getAsync(obj_name, key, default_value, cb) {
    setImmediate(() => {
      cb(null, this.get(obj_name, key, default_value));
    });
  }
}

export function create(store_path, one_file) {
  if (one_file) {
    return new DataStoreOneFile(store_path);
  } else {
    return new DataStore(store_path);
  }
}
