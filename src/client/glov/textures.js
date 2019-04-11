// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
/* eslint-env browser */
const assert = require('assert');

export let textures = {};
export let load_count = 0;
let aniso = 4;
let max_aniso = 0;
let aniso_enum;

let default_filter_min;
let default_filter_mag;

export const format = {
  RGB8: { count: 3 },
  RGBA8: { count: 4 },
};

export function defaultFilters(min, mag) {
  default_filter_min = min;
  default_filter_mag = mag;
}

const { isPowerOfTwo, nextHighestPowerOfTwo } = require('./vmath.js');

let bound_unit = null;
let bound_tex = [];

function setUnit(unit) {
  if (unit !== bound_unit) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    bound_unit = unit;
  }
}

function bindHandle(unit, target, handle) {
  if (bound_tex[unit] !== handle) {
    setUnit(unit);
    gl.bindTexture(target, handle);
    bound_tex[unit] = handle;
  }
}

function unbindHandle(target, handle) {
  for (let unit = 0; unit < bound_tex.length; ++unit) {
    if (bound_tex[unit] === handle) {
      setUnit(unit);
      gl.bindTexture(target, null);
      bound_tex[unit] = null;
    }
  }
}

export function bind(unit, tex) {
  // May or may not change the unit
  let handle = tex.loaded ? tex.handle : tex.load_fail ? textures.error.handle : textures.loading.handle;
  bindHandle(unit, tex.target, handle);
}

export function bindArray(texs) {
  for (let ii = 0; ii < texs.length; ++ii) {
    bind(ii, texs[ii]);
  }
}

function Texture(params) {
  this.loaded = false;
  this.load_fail = false;
  this.target = gl.TEXTURE_2D;
  this.handle = gl.createTexture();
  this.setSamplerState(params);

  this.format = params.format || format.RGBA8;

  if (params.data) {
    this.updateData(params.width, params.height, params.data);
  } else if (params.url) {
    this.loadURL(params.url);
  }
}

Texture.prototype.setSamplerState = function (params) {
  let target = this.target;
  setUnit(0);
  bound_tex[0] = null; // Force a re-bind, no matter what
  bindHandle(0, target, this.handle);

  let filter_min = params.filter_min || default_filter_min;
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, filter_min);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, params.filter_mag || default_filter_mag);
  gl.texParameteri(target, gl.TEXTURE_WRAP_S, params.wrap_s || gl.REPEAT);
  gl.texParameteri(target, gl.TEXTURE_WRAP_T, params.wrap_t || gl.REPEAT);

  this.mipmaps = filter_min >= 0x2700 && filter_min <= 0x2703; // Probably gl.LINEAR_MIPMAP_LINEAR

  if (max_aniso) {
    if (this.mipmaps && params.filter_mag !== gl.NEAREST) {
      gl.texParameterf(gl.TEXTURE_2D, aniso_enum, aniso);
    } else {
      gl.texParameterf(gl.TEXTURE_2D, aniso_enum, 1);
    }
  }
};

Texture.prototype.updateData = function updateData(w, h, data) {
  setUnit(0);
  bound_tex[0] = null; // Force a re-bind, no matter what
  bindHandle(0, this.target, this.handle);
  this.width = w;
  this.height = h;
  if (data instanceof Uint8Array) {
    gl.texImage2D(this.target, 0, this.format.internal_type, w, h, 0,
      this.format.internal_type, this.format.gl_type, data);
  } else {
    assert(data instanceof Image);
    // Pad up to power of two
    if (!isPowerOfTwo(w) || !isPowerOfTwo(h)) {
      this.width = nextHighestPowerOfTwo(w);
      this.height = nextHighestPowerOfTwo(h);
      gl.texImage2D(this.target, 0, this.format.internal_type, this.width, this.height, 0,
        this.format.internal_type, this.format.gl_type, null);
      // Duplicate right and bottom pixel row by sending image 3 times
      if (w !== this.width) {
        gl.texSubImage2D(this.target, 0, 1, 0, this.format.internal_type, this.format.gl_type, data);
      }
      if (h !== this.height) {
        gl.texSubImage2D(this.target, 0, 0, 1, this.format.internal_type, this.format.gl_type, data);
      }
      gl.texSubImage2D(this.target, 0, 0, 0, this.format.internal_type, this.format.gl_type, data);
    } else {
      gl.texImage2D(this.target, 0, this.format.internal_type, this.format.internal_type, this.format.gl_type, data);
    }
  }
  if (this.mipmaps) {
    gl.generateMipmap(this.target);
  }
  this.loaded = true;
};

Texture.prototype.loadURL = function loadURL(url) {
  let tex = this;
  let img = new Image();
  ++load_count;
  let did_done = false;
  function done() {
    if (!did_done) {
      did_done = true;
      --load_count;
    }
  }
  img.onload = function () {
    done();
    tex.format = format.RGBA8;
    tex.updateData(img.width, img.height, img);
  };
  function fail() {
    done();
    tex.load_fail = true;
  }
  img.onerror = fail;
  /* Turbulenz was doing it this way - some advantage?
  if (typeof URL !== "undefined" && URL.createObjectURL) {
    let xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        let xhrStatus = xhr.status;
        // Sometimes the browser sets status to 200 OK when the connection is closed
        // before the message is sent (weird!).
        // In order to address this we fail any completely empty responses.
        // Hopefully, nobody will get a valid response with no headers and no body!
        if (xhr.getAllResponseHeaders() === "" && !xhr.response) {
          fail();
        } else {
          if (xhrStatus === 200 || xhrStatus === 0) {
            var blob = xhr.response;
            img.onload = function blobImageLoadedFn() {
              imageLoaded();
              URL.revokeObjectURL(img.src);
              blob = null;
            };
            img.src = URL.createObjectURL(blob);
          } else {
            fail();
          }
        }
        xhr.onreadystatechange = null;
      }
    };
    xhr.open('GET', src, true);
    xhr.responseType = 'blob';
    xhr.send();
  } else { */
  img.crossOrigin = 'anonymous';
  img.src = url;
};

Texture.prototype.copyTexImage = function (x, y, w, h) {
  assert(w && h);
  bindHandle(0, this.target, this.handle);
  gl.copyTexImage2D(this.target, 0, gl.RGB, x, y, w, h, 0);
  this.width = w;
  this.height = h;
};

Texture.prototype.destroy = function () {
  delete textures[this.name];
  unbindHandle(this.target, this.handle);
  gl.deleteTexture(this.handle);
};

function create(params) {
  return new Texture(params);
}

export function createForCapture() {
  let texture = create({
    filter_min: gl.NEAREST,
    filter_mag: gl.NEAREST,
    wrap_s: gl.CLAMP_TO_EDGE,
    wrap_t: gl.CLAMP_TO_EDGE,
    format: gl.RGB8,
  });
  texture.loaded = true;
  texture.name = 'screen_temporary_tex';
  return texture;
}

export function load(params) {
  let key = params.name || params.url;
  assert(key);
  if (textures[key]) {
    return textures[key];
  }
  let texture = create(params);
  texture.name = key;
  textures[key] = texture;
  return texture;
}

export function startup() {

  default_filter_min = gl.LINEAR_MIPMAP_LINEAR;
  default_filter_mag = gl.LINEAR;

  format.RGB8.internal_type = gl.RGB;
  format.RGB8.gl_type = gl.UNSIGNED_BYTE;
  format.RGBA8.internal_type = gl.RGBA;
  format.RGBA8.gl_type = gl.UNSIGNED_BYTE;

  let ext_anisotropic = (
    gl.getExtension('EXT_texture_filter_anisotropic') ||
    gl.getExtension('MOZ_EXT_texture_filter_anisotropic') ||
    gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic')
  );
  if (ext_anisotropic) {
    aniso_enum = ext_anisotropic.TEXTURE_MAX_ANISOTROPY_EXT;
    aniso = max_aniso = gl.getParameter(ext_anisotropic.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
  }

  load({
    name: 'error',
    width: 2, height: 2,
    format: format.RGBA8,
    filter_mag: gl.NEAREST,
    data: new Uint8Array([
      255, 20, 147, 255,
      255, 0, 0, 255,
      255, 255, 255, 255,
      255, 20, 147, 255
    ]),
  });

  load({
    name: 'loading',
    width: 2, height: 2,
    format: format.RGBA8,
    data: new Uint8Array([
      127, 127, 127, 255,
      0, 0, 0, 255,
      64, 64, 64, 255,
      127, 127, 127, 255,
    ]),
  });

  load({
    name: 'white',
    width: 2, height: 2,
    format: format.RGBA8,
    data: new Uint8Array([
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
    ]),
  });
}
