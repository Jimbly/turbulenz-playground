// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const assert = require('assert');
const engine = require('./engine.js');
const fs = require('fs');

let last_id = 0;

let bound_prog = null;

export const semantic = {
  'ATTR0': 0,
  'POSITION': 0,
  'ATTR1': 1,
  'COLOR': 1,
  'COLOR_0': 1,
  'ATTR2': 2,
  'TEXCOORD': 2,
  'TEXCOORD_0': 2,
  'ATTR3': 3,
  'NORMAL': 3,
  'ATTR4': 4,
  'TEXCOORD_1': 4,
};

function findAll(str, re) {
  let ret = [];
  let m;
  do {
    m = re.exec(str);
    if (m) {
      ret.push(m[1]);
    }
  } while (m);
  return ret;
}

let globals;
let defines;

let error_fp;
let error_vp;

const vp_attr_regex = /attribute [^ ]+ ([^ ;]+);/gu;
const uniform_regex = /uniform (?:(?:low|medium|high)p )?((?:vec|mat)\d [^ ;]+);/gu;
const sampler_regex = /uniform sampler2D ([^ ;]+);/gu;

const type_size = {
  vec2: 2*1,
  vec3: 3*1,
  vec4: 4*1,
  mat3: 3*3,
  mat4: 4*4,
};

function Shader(type, text) {
  text = `${defines}${text}`;
  this.shader = gl.createShader(type);
  if (type === gl.VERTEX_SHADER) {
    this.programs = {};
    this.attributes = findAll(text, vp_attr_regex);
    // Ensure they are known names so we can give them indices
    // Add to semantic[] above as needed
    this.attributes.forEach((v) => assert(semantic[v] !== undefined));
  } else {
    this.id = ++last_id;
    this.samplers = findAll(text, sampler_regex);
    // Ensure all samplers end in a unique number
    let found = [];
    this.samplers.forEach((v) => {
      let num = Number(v.slice(-1));
      assert(!isNaN(num));
      assert(!found[num]);
      found[num] = true;
    });
  }
  this.uniforms = findAll(text, uniform_regex);
  // Ensure a known type
  this.uniforms.forEach((v) => {
    let type_name = v.split(' ')[0];
    assert(type_size[type_name]);
  });
  gl.shaderSource(this.shader, text);
  gl.compileShader(this.shader);

  if (!gl.getShaderParameter(this.shader, gl.COMPILE_STATUS)) {
    console.error(`Shader compile error: ${gl.getShaderInfoLog(this.shader)}`);
  }
}

export function create(...args) {
  return new Shader(...args);
}

function uniformSetValue(unif) {
  switch (unif.width) { // eslint-disable-line default-case
    case 2:
      gl.uniform2fv(unif.location, unif.value);
      break;
    case 3:
      gl.uniform3fv(unif.location, unif.value);
      break;
    case 4:
      gl.uniform4fv(unif.location, unif.value);
      break;
    case 9:
      gl.uniformMatrix3fv(unif.location, false, unif.value);
      break;
    case 16:
      gl.uniformMatrix4fv(unif.location, false, unif.value);
      break;
  }
}

function link(vp, fp) {
  let prog = vp.programs[fp.id] = {
    handle: gl.createProgram(),
    uniforms: null,
  };
  gl.attachShader(prog.handle, vp.shader);
  gl.attachShader(prog.handle, fp.shader);
  // call this for all relevant semantic
  for (let ii = 0; ii < vp.attributes.length; ++ii) {
    gl.bindAttribLocation(prog.handle, semantic[vp.attributes[ii]], vp.attributes[ii]);
  }
  gl.linkProgram(prog.handle);

  prog.valid = gl.getProgramParameter(prog.handle, gl.LINK_STATUS);
  if (!prog.valid) {
    console.error(`Shader link error: ${gl.getProgramInfoLog(prog.handle)}`);
  }

  gl.useProgram(prog.handle);
  bound_prog = prog;

  let uniforms = vp.uniforms.slice(0);
  for (let ii = 0; ii < fp.uniforms.length; ++ii) {
    let name = fp.uniforms[ii];
    if (uniforms.indexOf(name) === -1) {
      uniforms.push(name);
    }
  }
  prog.uniforms = uniforms.map((v) => {
    v = v.split(' ');
    let type = v[0];
    let name = v[1];
    let count = 1;
    let m = name.match(/([^[]+)\[(\d+)\]/u);
    if (m) {
      name = m[1];
      count = Number(m[2]);
    }
    let location = gl.getUniformLocation(prog.handle, name);
    if (location === null) {
      // Not in either shader, (commented out?), remove (via filter below)
      return null;
    }
    let width = type_size[type];
    let size = width * count;
    let glob = globals[name];
    let value = new Float32Array(size);
    // set initial value
    let unif = {
      name,
      size,
      width,
      count,
      value,
      location,
      glob,
    };
    uniformSetValue(unif);
    return unif;
  }).filter((v) => v);

  for (let ii = 0; ii < fp.samplers.length; ++ii) {
    let name = fp.samplers[ii];
    let num = Number(name.slice(-1));
    let location = gl.getUniformLocation(prog.handle, name);
    if (location !== null) {
      gl.uniform1i(location, num);
    }
  }
  return prog;
}

export function bind(vp, fp, params) {
  let prog = vp.programs[fp.id];
  if (!prog) {
    prog = link(vp, fp);
  }
  if (!prog.valid) {
    prog = link(vp, error_fp);
    if (!prog.valid) {
      prog = link(error_vp, error_fp);
    }
  }
  if (prog !== bound_prog) {
    bound_prog = prog;
    gl.useProgram(prog.handle);
  }
  for (let ii = 0; ii < prog.uniforms.length; ++ii) {
    let unif = prog.uniforms[ii];
    let value = params[unif.name] || unif.glob;
    if (!value) {
      continue;
    }
    let diff = false;
    for (let jj = 0; jj < unif.size; ++jj) {
      if (value[jj] !== unif.value[jj]) {
        diff = true;
        break;
      }
    }
    if (diff) {
      for (let jj = 0; jj < unif.size; ++jj) {
        unif.value[jj] = value[jj];
      }
      uniformSetValue(unif);
    }
  }
}

export function startup(_globals) {
  defines = Object.keys(engine.defines)
    .map((v) => `#define ${v}\n`)
    .join('');
  globals = _globals;

  error_fp = create(gl.FRAGMENT_SHADER, fs.readFileSync(`${__dirname}/shaders/error.fp`, 'utf8'));
  error_vp = create(gl.VERTEX_SHADER, fs.readFileSync(`${__dirname}/shaders/error.vp`, 'utf8'));
}
