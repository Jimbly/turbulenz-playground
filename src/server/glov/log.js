const fs = require('fs');
const path = require('path');
const { inspect } = require('util');

let log_dir = './logs/';

let last_uid = 0;
export function dumpFile(prefix, data, ext) {
  let filename = path.join(log_dir, `${prefix}-${process.pid}-${++last_uid}.${ext || 'log'}`);
  fs.writeFile(filename, data, function (err) {
    if (err) {
      console.error(`Error writing to log file ${filename}`, err);
    }
  });
  return filename;
}

const LOG_LEVELS = {
  debug: 4,
  log: 3,
  info: 2,
  warn: 1,
  error: 0,
};
const LOG_NAMES = {
  debug: 'debug',
  log: 'log  ',
  info: 'info ',
  warn: 'warn ',
  error: 'error',
};

export let log_level = LOG_LEVELS.debug;

function argProcessor(arg) {
  if (typeof arg === 'object') {
    return inspect(arg);
  }
  return arg;
}

export function startup(argv) {
  if (!fs.existsSync(log_dir)) {
    console.info(`Creating ${log_dir}...`);
    fs.mkdirSync(log_dir);
  }

  let is_dev = argv.dev;
  let native_default = console.log;
  let pid = process.pid;
  Object.keys(LOG_LEVELS).forEach(function (fn) {
    let native_fn = console[fn] || native_default;
    let my_level = LOG_LEVELS[fn];
    let prefix = ` ${LOG_NAMES[fn]}] `;
    console[fn] = function (...args) {
      ++last_uid;
      if (log_level < my_level) {
        return;
      }
      let ts = new Date().toISOString();
      let msg = (args || []).map(argProcessor).join(' ');
      if (is_dev) {
        ts = ts.slice(11, -5);
        msg = `[${ts}${prefix}${msg}`;
      } else {
        ts = ts.replace('T', ' ').slice(0, -1);
        msg = `[${ts} ${pid} ${last_uid}${prefix}${msg}`;
      }
      native_fn(msg);
    };
  });
}
