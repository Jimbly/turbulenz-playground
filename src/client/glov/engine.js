// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
/* eslint-env browser */

require('./bootstrap.js'); // Just in case it's not in app.js
const assert = require('assert');
const camera2d = require('./camera2d.js');
const effects = require('./effects.js');
const glov_font = require('./font.js');
const font_info_palanquin32 = require('../img/font/palanquin32.json');
const geom = require('./geom.js');
const input = require('./input.js');
const mat3FromMat4 = require('gl-mat3/fromMat4');
const mat4Copy = require('gl-mat4/copy');
const mat4Invert = require('gl-mat4/invert');
const mat4Mul = require('gl-mat4/multiply');
const mat4Transpose = require('gl-mat4/transpose');
const mat4Perspective = require('gl-mat4/perspective');
const { asin, cos, min, max, PI, sin, sqrt } = Math;
const models = require('./models.js');
const shaders = require('./shaders.js');
const sound_manager_dummy = require('./sound_manager_dummy.js');
const sprites = require('./sprites.js');
const textures = require('./textures.js');
const glov_transition = require('./transition.js');
const glov_ui = require('./ui.js');
const urlhash = require('./urlhash.js');
const { ridx } = require('../../common/util.js');
const { mat3, mat4, vec3, vec4, v3mulMat4, v3normalize, v4copy, v4set } = require('./vmath.js');

export let canvas;
export let glov_particles;
export let sound_manager;

export let width;
export let height;
export let pixel_aspect = 1;
export let antialias;
let clear_bits;

export let game_width;
export let game_height;

export let render_width;
export let render_height;

export let defines = urlhash.register({ key: 'D', type: urlhash.TYPE_SET });

export let any_3d = false;
export let ZFAR;
export let ZNEAR;
export let fov_y = 1;
export let fov_x = 1;
export let fov_min = 60 * PI / 180;

export let mat_projection = mat4();
export let mat_view = mat4();
let mat_m = mat4();
export let mat_vp = mat4();
let mat_mv = mat4();
let mat_mv_no_skew = mat4();
let mat_mvp = mat4();
let mat_mv_inv_transform = mat3();
let projection_inverse = vec4();

export let light_diffuse = vec3(0.75, 0.75, 0.75);
let light_dir_vs = vec3(0, 0, 0);
export let light_ambient = vec3(0.25, 0.25, 0.25);
export let light_dir_ws = vec3(-1, -2, -3);

export let font;
export let app_state = null;
export const border_color = vec4(0, 0, 0, 1);
export const pico8_colors = [
  vec4(0, 0, 0, 1),
  vec4(0.114, 0.169, 0.326, 1),
  vec4(0.494, 0.145, 0.326, 1),
  vec4(0.000, 0.529, 0.328, 1),
  vec4(0.671, 0.322, 0.212, 1),
  vec4(0.373, 0.341, 0.310, 1),
  vec4(0.761, 0.765, 0.780, 1),
  vec4(1.000, 0.945, 0.910, 1),
  vec4(1.000, 0.000, 0.302, 1),
  vec4(1.000, 0.639, 0.000, 1),
  vec4(1.000, 0.925, 0.153, 1),
  vec4(0.000, 0.894, 0.212, 1),
  vec4(0.161, 0.678, 1.000, 1),
  vec4(0.514, 0.463, 0.612, 1),
  vec4(1.000, 0.467, 0.659, 1),
  vec4(1.000, 0.800, 0.667, 1),
];

export let fps_style = glov_font.style({
  outline_width: 2, outline_color: 0x00000080,
  color: 0xFFFFFFff,
});

export function setGlobalMatrices(_mat_view) {
  mat4Copy(mat_view, _mat_view);
  mat4Mul(mat_vp, mat_projection, mat_view);
  v3normalize(light_dir_ws, light_dir_ws);
  v3mulMat4(light_dir_vs, light_dir_ws, mat_view);
}

export function setFOV(new_fov) {
  fov_min = new_fov;
}

function normalizeRow(m, idx) {
  let len = m[idx]*m[idx] + m[idx+1]*m[idx+1] + m[idx+2]*m[idx+2];
  if (len > 0) {
    len = 1 / sqrt(len);
    m[idx] *= len;
    m[idx+1] *= len;
    m[idx+2] *= len;
  }
}

let mat_temp = mat4();
export function updateMatrices(mat_model) {
  // PERFTODO: depending on rendering path, only some of these are needed (m + vp or just mvp)
  mat4Copy(mat_m, mat_model);

  mat4Mul(mat_mv, mat_view, mat_model);
  mat4Mul(mat_mvp, mat_projection, mat_mv);
  // TODO: Can expand and simplify all of this, especially below
  // Compute the inverse transform of thee model_view matrix, discarding scale,
  // to be used for getting normals into view space
  mat4Copy(mat_temp, mat_model);
  normalizeRow(mat_temp, 0);
  normalizeRow(mat_temp, 4);
  normalizeRow(mat_temp, 8);
  mat4Mul(mat_mv_no_skew, mat_view, mat_temp);
  mat4Invert(mat_temp, mat_mv_no_skew);
  mat4Transpose(mat_temp, mat_temp);
  mat3FromMat4(mat_mv_inv_transform, mat_temp);
}
export let global_timer = 0;
export function getFrameTimestamp() {
  return global_timer;
}

export let global_frame_index = 0;
export function getFrameIndex() {
  return global_frame_index;
}

export let this_frame_time = 0;
export function getFrameDt() {
  return this_frame_time;
}

// Wall time, may contain large jumps, may be 0 or negative
let this_frame_time_actual = 0;
export function getFrameDtActual() {
  return this_frame_time_actual;
}

let after_loading_state = null;
export let is_loading = true;
export function setState(new_state) {
  if (is_loading) {
    after_loading_state = new_state;
  } else {
    app_state = new_state;
  }
}

export function stateActive(test_state) {
  if (is_loading) {
    return after_loading_state === test_state;
  } else {
    return app_state === test_state;
  }
}

let mspf = 1000;
let mspf_update_time = Date.now();
let mspf_frame_count = 0;
let show_fps = true;

let do_borders = true;
let do_viewport_postprocess = false;
let need_repos = 0;

let app_tick_functions = [];
export function addTickFunc(cb) {
  app_tick_functions.push(cb);
}

let post_tick = [];
export function postTick(ticks, fn) {
  assert(typeof fn === 'function');
  post_tick.push({ ticks, fn });
}

let temporary_textures = {};

function resetEffects() {
  for (let key in temporary_textures) {
    let temp = temporary_textures[key];
    // Release unused textures
    while (temp.list.length > temp.idx) {
      temp.list.pop().destroy();
    }
    if (!temp.idx) {
      delete temporary_textures[key];
    } else {
      temp.idx = 0;
    }
  }
}

let last_canvas_width;
let last_canvas_height;
function resizeCanvas() {
  let css_to_real = window.devicePixelRatio || 1;
  window.pixel_scale = css_to_real;
  last_canvas_width = canvas.width = Math.round(canvas.clientWidth * css_to_real);
  last_canvas_height = canvas.height = Math.round(canvas.clientHeight * css_to_real);

  // For the next 10 frames, make sure font size is correct
  need_repos = 10;
}

function checkResize() {
  let css_to_real = window.devicePixelRatio || 1;
  let new_width = Math.round(canvas.clientWidth * css_to_real);
  let new_height = Math.round(canvas.clientHeight * css_to_real);
  if (new_width !== last_canvas_width || new_height !== last_canvas_height) {
    resizeCanvas();
  }
}

export let viewport = vec4(0,0,1,1);
export function setViewport(xywh) {
  v4copy(viewport, xywh);
  gl.viewport(xywh[0], xywh[1], xywh[2], xywh[3]);
}

export function getTemporaryTexture(w, h) {
  let key = w ? `${w}_${h}` : 'screen';
  let temp = temporary_textures[key];
  if (!temp) {
    temp = temporary_textures[key] = { list: [], idx: 0 };
  }
  if (temp.idx >= temp.list.length) {
    let tex = textures.createForCapture();
    temp.list.push(tex);
  }
  let tex = temp.list[temp.idx++];
  tex.override_sampler = null; // in case the previous user set it
  return tex;
}

export function captureFramebuffer(tex, w, h, do_filter_linear, do_wrap) {
  if (!w && render_width) {
    w = render_width;
    h = render_height;
  }
  if (!tex) {
    tex = getTemporaryTexture(w, h);
  }
  if (w) {
    tex.copyTexImage(viewport[0], viewport[1], w, h);
  } else {
    tex.copyTexImage(0, 0, width, height);
  }
  tex.setSamplerState({
    filter_min: do_filter_linear ? gl.LINEAR : gl.NEAREST,
    filter_mag: do_filter_linear ? gl.LINEAR : gl.NEAREST,
    wrap_s: do_wrap ? gl.REPEAT : gl.CLAMP_TO_EDGE,
    wrap_t: do_wrap ? gl.REPEAT : gl.CLAMP_TO_EDGE,
  });
  return tex;
}

let last_tick = Date.now();
function tick() {
  let now = Date.now();
  if (defines.SLOWLOAD && is_loading) {
    // Safari on CrossBrowserTesting needs this in order to have some time to load/decode audio data
    setTimeout(function () {
      requestAnimationFrame(tick);
    }, 500);
  } else {
    requestAnimationFrame(tick);
  }
  this_frame_time_actual = now - last_tick;
  let dt = min(max(this_frame_time_actual, 1), 250);
  this_frame_time = dt;
  last_tick = now;
  global_timer += dt;
  ++global_frame_index;

  ++mspf_frame_count;
  if (now - mspf_update_time > 1000) {
    mspf = (now - mspf_update_time) / mspf_frame_count;
    mspf_frame_count = 0;
    mspf_update_time = now;
    // if (show_fps && fps_elem) {
    //   fps_elem.innerText = `${(1000 / mspf).toFixed(0)}fps (${mspf.toFixed(1)} ms/f)`;
    // }
  }

  if (document.hidden || document.webkitHidden) {
    resetEffects();
    // Maybe post-tick here too?
    return;
  }

  checkResize();
  width = canvas.width;
  height = canvas.height;

  if (any_3d) {
    if (width > height) {
      fov_y = fov_min;
      let rise = width/height * sin(fov_y / 2) / cos(fov_y / 2);
      fov_x = 2 * asin(rise / sqrt(rise * rise + 1));
    } else {
      fov_x = fov_min;
      let rise = height/width * sin(fov_x / 2) / cos(fov_x / 2);
      fov_y = 2 * asin(rise / sqrt(rise * rise + 1));
    }
    mat4Perspective(mat_projection, fov_y, width/height, ZNEAR, ZFAR);
    v4set(projection_inverse,
      2 / (width * mat_projection[0]), // projection_matrix.m00),
      2 / (height * mat_projection[5]), // projection_matrix.m11),
      -(1 + mat_projection[8]) / mat_projection[0], // projection_matrix.m20) / projection_matrix.m00,
      -(1 + mat_projection[9]) / mat_projection[5] // projection_matrix.m21) / projection_matrix.m11
    );
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  } else {
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
  }
  textures.bind(0, textures.textures.error);

  camera2d.tickCamera2D();
  camera2d.setAspectFixed(game_width, game_height);

  sound_manager.tick(dt);
  input.tickInput();
  glov_ui.tickUI(dt);

  if (need_repos) {
    --need_repos;
    let ul = [];
    camera2d.virtualToDom(ul, [0,0]);
    let lr = [];
    camera2d.virtualToDom(lr, [game_width-1,game_height-1]);
    let viewport2 = [ul[0], ul[1], lr[0], lr[1]];
    let view_height = viewport2[3] - viewport2[1];
    // default font size of 16 when at height of game_height
    let font_size = Math.min(256, Math.max(2, Math.floor(view_height/800 * 16)));
    document.getElementById('fullscreen').style['font-size'] = `${font_size}px`;
  }

  if (any_3d) {
    gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
    gl.clear(clear_bits);
    gl.enable(gl.CULL_FACE);
  }

  if (do_borders) {
    // Borders
    glov_ui.drawRect(camera2d.x0(), camera2d.y0(), camera2d.x1(), 0, Z.BORDERS, border_color);
    glov_ui.drawRect(camera2d.x0(), game_height, camera2d.x1(), camera2d.y1(), Z.BORDERS, border_color);
    glov_ui.drawRect(camera2d.x0(), 0, 0, game_height, Z.BORDERS, border_color);
    glov_ui.drawRect(game_width, 0, camera2d.x1(), game_height, Z.BORDERS, border_color);
  }

  for (let ii = 0; ii < app_tick_functions.length; ++ii) {
    app_tick_functions[ii](dt);
  }
  if (app_state) {
    app_state(dt);
  }
  if (show_fps) {
    camera2d.setAspectFixed(game_width, game_height);
    font.drawSizedAligned(fps_style, camera2d.x0(), camera2d.y0(), Z.FPSMETER, glov_ui.font_height,
      glov_font.ALIGN.HRIGHT, camera2d.w(), 0, `FPS: ${(1000 / mspf).toFixed(1)} (${mspf.toFixed(0)}ms/f)`);
  }

  glov_particles.tick(dt); // *after* app_tick, so newly added/killed particles can be queued into the draw list
  glov_transition.render(dt);

  if (any_3d) {
    gl.disable(gl.CULL_FACE);
  } else {
    // delaying clear until later, app might change clear color
    gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
    // gl.scissor(0, 0, viewport[2] - viewport[0], viewport[3] - viewport[1]);
    gl.clear(clear_bits);
  }

  sprites.draw();

  glov_ui.endFrame();

  if (render_width) {
    let source = captureFramebuffer();
    let clear_color = [0, 0, 0, 1];
    let final_viewport = [
      camera2d.render_offset_x, camera2d.render_offset_y,
      camera2d.render_viewport_w, camera2d.render_viewport_h
    ];
    if (do_viewport_postprocess) {
      effects.applyPixelyExpand({ source, final_viewport, clear_color });
    } else {
      if (clear_color) {
        gl.clearColor(clear_color[0], clear_color[1], clear_color[2], clear_color[3]);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      setViewport(final_viewport);
      // gl.scissor(0, 0, width, height);
      effects.applyCopy({ source });
    }
  }

  input.endFrame();
  resetEffects();

  for (let ii = post_tick.length - 1; ii >= 0; --ii) {
    if (!--post_tick[ii].ticks) {
      post_tick[ii].fn();
      ridx(post_tick, ii);
    }
  }
}

let error_report_details = {};
let error_report_details_str = '';
export function setErrorReportDetails(key, value) {
  if (value) {
    error_report_details[key] = escape(String(value));
  } else {
    delete error_report_details[key];
  }
  error_report_details_str = `&${Object.keys(error_report_details)
    .map((k) => `${k}=${error_report_details[k]}`)
    .join('&')}`;
}
setErrorReportDetails('ver', BUILD_TIMESTAMP);
let last_error_time = 0;
let crash_idx = 0;
function glovErrorReport(msg, file, line, col) {
  ++crash_idx;
  let now = Date.now();
  let dt = now - last_error_time;
  last_error_time = now;
  if (dt < 30*1000) {
    // Less than 30 seconds since the last error, either we're erroring every
    // frame, or this is a secondary error caused by the first, do not report it.
    // Could maybe hash the error message and just report each message once, and
    // flag errors as primary or secondary.
    return;
  }
  // Post to an error reporting endpoint that (probably) doesn't exist - it'll get in the logs anyway!
  let url = (location.href || '').match(/^[^#?]*/u)[0];
  url += `errorReport?cidx=${crash_idx}&file=${escape(file)}&line=${line}&col=${col}&url=${escape(location.href)}` +
    `&msg=${escape(msg)}${error_report_details_str}`;
  let xhr = new XMLHttpRequest();
  xhr.open('POST', url, true);
  xhr.send(null);
}

export function startup(params) {
  // globals for leftover Turbulenz bits
  window.TurbulenzEngine = null;
  window.assert = assert;

  canvas = document.getElementById('canvas');

  if (params.error_report !== false) {
    window.glov_error_report = glovErrorReport;
  }

  // resize the canvas to fill browser window dynamically
  window.addEventListener('resize', resizeCanvas, false);
  resizeCanvas();

  let is_pixely = params.pixely && params.pixely !== 'off';
  antialias = params.antialias || !is_pixely && params.antialias !== false;
  let powerPreference = 'high-performance';
  let context_names = ['webgl', 'experimental-webgl'];
  let context_opts = [{ antialias, powerPreference }, { powerPreference }, {}];
  let good = false;
  for (let i = 0; !good && i < context_names.length; i += 1) {
    for (let jj = 0; !good && jj < context_opts.length; ++jj) {
      try {
        window.gl = canvas.getContext(context_names[i], context_opts[jj]);
        if (window.gl) {
          good = true;
          break;
        }
      } catch (e) {
        // ignore
      }
    }
  }
  if (!good) {
    // eslint-disable-next-line no-alert
    window.alert('Sorry, but your browser does not support WebGL or does not have it enabled.');
    document.getElementById('loading').style.visibility = 'hidden';
    document.getElementById('nowebgl').style.visibility = 'visible';
    return false;
  }

  assert(gl);
  canvas.focus();
  width = canvas.width;
  height = canvas.height;
  game_width = params.game_width || 1280;
  game_height = params.game_height || 960;
  any_3d = params.any_3d || false;
  ZNEAR = params.znear || 0.7;
  ZFAR = params.zfar || 10000;
  if (params.pixely === 'strict') {
    render_width = game_width;
    render_height = game_height;
    if (params.viewport_postprocess) {
      do_viewport_postprocess = true;
    }
  } else {
    render_width = undefined;
    render_height = undefined;
  }
  pixel_aspect = params.pixel_aspect || 1;

  gl.depthFunc(gl.LEQUAL);
  // gl.enable(gl.SCISSOR_TEST);
  if (!any_3d) {
    gl.disable(gl.CULL_FACE);
  }
  gl.cullFace(gl.BACK);
  gl.clearColor(0, 0.1, 0.2, 1);

  textures.startup();
  geom.startup();
  shaders.startup({
    light_diffuse,
    light_dir_vs,
    ambient: light_ambient,
    mat_m: mat_m,
    mat_mv: mat_mv,
    mat_vp: mat_vp,
    mvp: mat_mvp,
    mv_inv_trans: mat_mv_inv_transform,
    view: mat_view,
    projection: mat_projection,
    projection_inverse,
  });
  camera2d.startup();
  sprites.startup();
  input.startup(canvas, params);
  if (any_3d) {
    models.startup();
  }

  if (any_3d) {
    // eslint-disable-next-line no-bitwise
    clear_bits = gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT;
  } else {
    clear_bits = gl.COLOR_BUFFER_BIT;
  }

  /* eslint-disable global-require */
  glov_particles = require('./particles.js').create();

  if (is_pixely) {
    textures.defaultFilters(gl.NEAREST, gl.NEAREST);
  } else {
    textures.defaultFilters(gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR);
  }

  const font_info_04b03x2 = require('../img/font/04b03_8x2.json');
  const font_info_04b03x1 = require('../img/font/04b03_8x1.json');
  if (params.font) {
    font = glov_font.create(params.font.info, params.font.texture);
  } else if (params.pixely === 'strict') {
    font = glov_font.create(font_info_04b03x1, 'font/04b03_8x1');
  } else if (is_pixely) {
    font = glov_font.create(font_info_04b03x2, 'font/04b03_8x2');
  } else {
    font = glov_font.create(font_info_palanquin32, 'font/palanquin32');
  }
  glov_ui.startup(font, params.ui_sprites);

  if (params.sound_manager) {
    // Require caller to require this module, so we don't force it loaded/bundled in programs that do not need it
    sound_manager = params.sound_manager;
    glov_ui.bindSounds(sound_manager, { // TODO: Allow overriding?
      button_click: 'button_click',
      rollover: 'rollover',
    });
  } else {
    sound_manager = sound_manager_dummy;
  }

  camera2d.setAspectFixed(game_width, game_height);

  if (params.state) {
    setState(params.state);
  }
  if (params.do_borders !== undefined) {
    do_borders = params.do_borders;
  }
  if (params.show_fps !== undefined) {
    show_fps = params.show_fps;
  }

  requestAnimationFrame(tick);
  return true;
}

export function loadsPending() {
  return textures.load_count + sound_manager.loading() + models.load_count;
}

function loading() {
  let load_count = loadsPending();
  document.getElementById('loading_text').innerText = `Loading (${load_count})...`;
  if (!load_count) {
    is_loading = false;
    app_state = after_loading_state;
    // Clear after next frame, so something is rendered to the canvas
    postTick(2, function () {
      document.getElementById('loading').style.visibility = 'hidden';
    });
  }
}
app_state = loading;

window.glov_engine = exports;
