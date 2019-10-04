// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const assert = require('assert');
const { isInteger } = require('./util.js');

function canonical(cmd) {
  return cmd.toLowerCase().replace(/[_.]/gu, '');
}

export const TYPE_INT = 0;
export const TYPE_FLOAT = 1;
export const TYPE_STRING = 2;
const TYPE_NAME = ['INTEGER', 'NUMBER', 'STRING'];

function CmdParse() {
  this.cmds = {};
  this.was_not_found = false;
}
CmdParse.prototype.handle = function (self, str, resp_func) {
  this.was_not_found = false;
  let m = str.match(/^([^\s]+)(?:\s+(.*))?$/u);
  if (!m) {
    resp_func('Missing command');
    return true;
  }
  let cmd = canonical(m[1]);
  if (!this.cmds[cmd]) {
    this.was_not_found = true;
    resp_func(`Unknown command: "${m[1]}"`);
    return false;
  }
  this.cmds[cmd].call(self, m[2] || '', resp_func);
  return true;
};

CmdParse.prototype.register = function (cmd, func) {
  this.cmds[canonical(cmd)] = func;
};

CmdParse.prototype.registerValue = function (cmd, param) {
  assert(TYPE_NAME[param.type] || !param.set);
  assert(param.set || param.get);
  let label = param.label || cmd;
  this.cmds[canonical(cmd)] = function (str, resp_func) {
    function value() {
      resp_func(null, `${label} = ${param.get()}`);
    }
    function usage() {
      resp_func(`Usage: /${cmd} ${TYPE_NAME[param.type]}`);
    }
    if (!str) {
      if (param.get) {
        return value();
      } else {
        return usage();
      }
    }
    if (!param.set) {
      return resp_func(`Usage: /${cmd}`);
    }
    let n = Number(str);
    if (param.range) {
      if (n < param.range[0]) {
        n = param.range[0];
      } else if (n > param.range[1]) {
        n = param.range[1];
      }
    }
    if (param.type === TYPE_INT) {
      if (!isInteger(n)) {
        return usage();
      }
      param.set(n);
    } else if (param.type === TYPE_FLOAT) {
      if (!isFinite(n)) {
        return usage();
      }
      param.set(n);
    } else {
      param.set(str);
    }
    if (param.get) {
      return value();
    } else {
      return resp_func(null, `${label} udpated`);
    }
  };
};

CmdParse.prototype.TYPE_INT = TYPE_INT;
CmdParse.prototype.TYPE_FLOAT = TYPE_FLOAT;
CmdParse.prototype.TYPE_STRING = TYPE_STRING;

export function create() {
  return new CmdParse();
}
