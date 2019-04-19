// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
/* eslint no-bitwise:off */

const assert = require('assert');
const { ceil, max } = Math;

export const QUADS = 7;

const gl_byte_size = {
  0x1400: 1, // GL_BYTE
  0x1401: 1, // GL_UNSIGNED_BYTE
  0x1402: 2, // GL_SHORT
  0x1403: 2, // GL_UNSIGNED_SHORT
  0x1406: 4, // GL_FLOAT
};

// let unit_buf;
// let unit_buf_len = 0;

let bound_geom;

let bound_array_buf = null;
let bound_index_buf = null;

let quad_index_buf;
let quad_index_buf_len = 0;

function deleteBuffer(handle) {
  if (!handle) {
    return;
  }
  if (bound_array_buf === handle) {
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    bound_array_buf = null;
  }
  if (bound_index_buf === handle) {
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    bound_index_buf = null;
  }
  gl.deleteBuffer(handle);
}

let attrib_enabled = 0;
function enableVertexAttribArray(bits) {
  if (bits === attrib_enabled) {
    return;
  }
  let disable_mask = (attrib_enabled & (~bits));
  let enable_mask = ((~attrib_enabled) & bits);
  attrib_enabled = bits;

  if (disable_mask) {
    let n = 0;
    do {
      if (disable_mask & 1) {
        gl.disableVertexAttribArray(n);
      }
      n++;
      disable_mask >>= 1;
    } while (disable_mask);
  }

  if (enable_mask) {
    let n = 0;
    do {
      if (enable_mask & 1) {
        gl.enableVertexAttribArray(n);
      }
      n++;
      enable_mask >>= 1;
    } while (enable_mask);
  }
}

// function bindUnitBuf(arr_idx, len) {
//   if (len > unit_buf_len) {
//     deleteBuffer(unit_buf);
//     unit_buf = gl.createBuffer();
//     unit_buf_len = max(ceil(unit_buf_len * 1.5), len);
//     gl.bindBuffer(gl.ARRAY_BUFFER, unit_buf);
//     bound_array_buf = unit_buf;
//     let arr = new Uint8Array(unit_buf_len * 4);
//     for (let ii = 0; ii < unit_buf_len * 4; ++ii) {
//       arr[ii] = 255;
//     }
//     gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
//   } else {
//     if (bound_array_buf !== unit_buf) {
//       gl.bindBuffer(gl.ARRAY_BUFFER, unit_buf);
//       bound_array_buf = unit_buf;
//     }
//   }
//   gl.vertexAttribPointer(arr_idx, 4, gl.UNSIGNED_BYTE, true, 0, 0);
// }

// Verts should be ordered counter-clockwise from the upper left
function getQuadIndexBuf(quad_count) {
  assert(quad_count <= 16384);
  // If not, need to split into multiple vertex and index buffers (fairly easy),
  //   or use the OES_element_index_uint extension (trivial, but probably slower, maybe not supported on mobile?)
  if (quad_count * 6 > quad_index_buf_len) {
    if (!quad_index_buf) {
      quad_index_buf = gl.createBuffer();
    }
    quad_index_buf_len = max(ceil(quad_index_buf_len * 1.5), quad_count * 6);
    if (bound_index_buf !== quad_index_buf) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quad_index_buf);
      bound_index_buf = quad_index_buf;
    }
    let arr = new Uint16Array(quad_index_buf_len);
    let vidx = 0;
    for (let ii = 0; ii < quad_index_buf_len;) {
      arr[ii++] = vidx + 1;
      arr[ii++] = vidx + 3;
      arr[ii++] = vidx++; // 0
      arr[ii++] = vidx++; // 1
      arr[ii++] = vidx++; // 2
      arr[ii++] = vidx++; // 3
    }
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, arr, gl.STATIC_DRAW);
  }
  return quad_index_buf;
}


// _format is [shader.semantic.foo, gl.FLOAT/UNSIGNED_BYTE/etc, count, normalized]
function Geom(_format, verts, idxs, mode) {
  this.mode = mode || gl.TRIANGLES;
  this.format = _format;
  this.stride = 0;
  this.elem_count = 0;
  this.used_attribs = 0;
  for (let ii = 0; ii < _format.length; ++ii) {
    let fmt = _format[ii];
    let sem = fmt[0];
    let gltype = fmt[1];
    let count = fmt[2];
    this.used_attribs |= (1 << sem);
    let byte_size = gl_byte_size[gltype];
    assert(byte_size);
    fmt[3] = fmt[3] || false;
    fmt[4] = byte_size;
    this.stride += count * byte_size;
    this.elem_count += count;
  }
  this.vert_count = verts.length / this.elem_count;
  if (verts.length) {
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    bound_array_buf = this.vbo;
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  }
  this.orig_mode = mode;
  if (idxs) {
    this.ibo = gl.createBuffer();
    this.ibo_owned = true;
    this.ibo_size = idxs.length;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    bound_index_buf = this.ibo;
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxs, gl.STATIC_DRAW);
  } else if (mode === QUADS) {
    assert(this.vert_count % 4 === 0);
    let quad_count = this.vert_count / 4;
    // PERFTODO: Use GL_QUADS_OES extension
    this.ibo = getQuadIndexBuf(quad_count);
    this.ibo_owned = false;
    this.ibo_size = quad_count * 6;
    this.mode = gl.TRIANGLES;
  } else {
    this.ibo = null;
    this.ibo_owned = false;
  }
}

Geom.prototype.update = function (verts, num_verts) {
  assert(this.orig_mode === QUADS);
  if (num_verts > this.vert_count) {
    if (bound_geom === this) {
      bound_geom = null;
    }
    deleteBuffer(this.vbo);
    // Note: matching size, ignoring num_verts
    this.vert_count = verts.length / this.elem_count;
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    bound_array_buf = this.vbo;
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
  } else {
    // Fits
    if (bound_array_buf !== this.vbo) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      bound_array_buf = this.vbo;
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts.subarray(0, num_verts * this.elem_count));
    // gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
  }
  let quad_count = num_verts / 4;
  this.ibo = getQuadIndexBuf(quad_count);
  this.ibo_size = quad_count * 6;
};

Geom.prototype.dispose = function () {
  if (this.ibo_owned) {
    deleteBuffer(this.ibo);
  }
  this.ibo = null;
  deleteBuffer(this.vbo);
  this.vbo = null;
};


let bound_attribs = (function () {
  let r = [];
  for (let ii = 0; ii < 16; ++ii) {
    r.push({
      vbo: null,
      offset: 0,
    });
  }
  return r;
}());
Geom.prototype.bind = function () {
  if (bound_geom !== this) {
    bound_geom = this;
    let vbo = this.vbo;

    let offset = 0;
    for (let ii = 0; ii < this.format.length; ++ii) {
      let fmt = this.format[ii];
      let count = fmt[2];
      let byte_size = fmt[4];
      if (bound_attribs[ii].vbo === vbo) { //  && bound_attribs[ii].offset = offset
        // already bound
      } else {
        if (bound_array_buf !== vbo) {
          gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
          bound_array_buf = vbo;
        }
        let sem = fmt[0];
        let gltype = fmt[1];
        let normalized = fmt[3];
        gl.vertexAttribPointer(sem, count, gltype, normalized, this.stride, offset);
        bound_attribs[ii].vbo = bound_array_buf;
        // bound_attribs[ii].offset = offset;
      }
      offset += count * byte_size;
    }
    // if (!used[1]) { // COLOR
    //   used_attribs |= 1 << shader.semantics.COLOR;
    //   bindUnitBuf(1, this.vert_count);
    // }
    enableVertexAttribArray(this.used_attribs);

    if (this.ibo && bound_index_buf !== this.ibo) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      bound_index_buf = this.ibo;
    }
  }
};
Geom.prototype.draw = function () {
  this.bind();
  assert(this.ibo); // else: gl.drawArrays(this.mode, ... this.ibo_size, gl.UNSIGNED_SHORT, 0);
  gl.drawElements(this.mode, this.ibo_size, gl.UNSIGNED_SHORT, 0);
};

export function create(...args) {
  return new Geom(...args);
}

export function startup() {
  // Nothing for now.
}
