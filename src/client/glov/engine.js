// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

/* eslint-env browser */
/* global Z:false */

const assert = require('assert');
const camera2d = require('./camera2d.js');
const effects = require('./effects.js');
const glov_font = require('./font.js');
const font_info_palanquin32 = require('../img/font/palanquin32.json');
const geom = require('./geom.js');
const input = require('./input.js');
const local_storage = require('./local_storage.js');
const mat3FromMat4 = require('gl-mat3/fromMat4');
const mat4Copy = require('gl-mat4/copy');
const mat4Invert = require('gl-mat4/invert');
const mat4Mul = require('gl-mat4/multiply');
const mat4Transpose = require('gl-mat4/transpose');
const mat4Perspective = require('gl-mat4/perspective');
const { asin, cos, min, max, PI, sin, sqrt } = Math;
const shaders = require('./shaders.js');
const sprites = require('./sprites.js');
const textures = require('./textures.js');
const glov_transition = require('./transition.js');
const glov_ui = require('./ui.js');
const { mat3, mat4, vec3, vec4, v3mulMat4, v3normalize, v4copy } = require('./vmath.js');

let canvas;
export let glov_particles;
export let sound_manager;

export let width;
export let height;
export let pixel_aspect = 1;
let clear_bits;

export let game_width;
export let game_height;

export let render_width;
export let render_height;

export let defines = {};

export const ZFAR = 10000;
export const fov_y = 45 * PI / 180;
export let fov_x = 1;

export let mat_projection = mat4();
export let mat_view = mat4();
let mat_m = mat4();
let mat_vp = mat4();
let mat_mv = mat4();
let mat_mvp = mat4();
let mat_mv_inv_transform = mat3();

export let light_diffuse = vec3(0.75, 0.75, 0.75);
let light_dir_vs = vec3(0, 0, 0);
let light_ambient = vec3(0.25, 0.25, 0.25);
export let light_dir_ws = vec3(-1, -2, -3);

export let font;
export let app_state = null;
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

let mat_temp = mat4();
export function updateMatrices(mat_model) {
  // PERFTODO: depending on rendering path, only some of these are needed (m + vp or just mvp)
  mat4Copy(mat_m, mat_model);

  mat4Mul(mat_mv, mat_view, mat_model);
  mat4Mul(mat_mvp, mat_projection, mat_mv);
  // TODO: Can expand and simplify all of this, especially below
  mat4Invert(mat_temp, mat_mv);
  mat4Transpose(mat_temp, mat_temp);
  mat3FromMat4(mat_mv_inv_transform, mat_temp);
}

// *Maybe* don't need this logic anymore, postprocessing has been improved to be
// efficient on all devices.
const postprocessing_reset_version = '2';
export let postprocessing = local_storage.get('glov_no_postprocessing') !== postprocessing_reset_version;
export function postprocessingAllow(allow) {
  local_storage.set('glov_no_postprocessing', allow ? undefined : postprocessing_reset_version);
  postprocessing = allow;
}

let global_timer = 0;
export function getFrameTimestamp() {
  return global_timer;
}

let global_frame_index = 0;
export function getFrameIndex() {
  return global_frame_index;
}

let this_frame_time = 0;
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
  requestAnimationFrame(tick);
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
    return;
  }

  width = canvas.width;
  height = canvas.height;

  let rise = width/height * sin(fov_y / 2) / cos(fov_y / 2);
  fov_x = 2 * asin(rise / sqrt(rise * rise + 1));
  mat4Perspective(mat_projection, fov_y, width/height, 0.7, ZFAR);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.enable(gl.BLEND);
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
  textures.bind(0, textures.textures.error);

  camera2d.tick();
  camera2d.setAspectFixed(game_width, game_height);

  sound_manager.tick(dt);
  input.tick();
  glov_ui.tick(dt);

  if (need_repos) {
    --need_repos;
    let ul = [];
    camera2d.virtualToPhysical(ul, [0,0]);
    let lr = [];
    camera2d.virtualToPhysical(lr, [game_width-1,game_height-1]);
    let viewport2 = [ul[0], ul[1], lr[0], lr[1]];
    let view_height = viewport2[3] - viewport2[1];
    // default font size of 16 when at height of game_height
    let font_size = Math.min(256, Math.max(2, Math.floor(view_height/800 * 16)));
    document.getElementById('fullscreen').style['font-size'] = `${font_size}px`;
  }

  if (do_borders) {
    // Borders
    glov_ui.drawRect(camera2d.x0(), camera2d.y0(), camera2d.x1(), 0, Z.BORDERS,
      pico8_colors[0]);
    glov_ui.drawRect(camera2d.x0(), game_height, camera2d.x1(), camera2d.y1(), Z.BORDERS,
      pico8_colors[0]);
    glov_ui.drawRect(camera2d.x0(), 0, 0, game_height, Z.BORDERS,
      pico8_colors[0]);
    glov_ui.drawRect(game_width, 0, camera2d.x1(), game_height, Z.BORDERS,
      pico8_colors[0]);
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

  // Above is queuing, below is actual drawing

  gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
  // gl.scissor(0, 0, viewport[2] - viewport[0], viewport[3] - viewport[1]);
  gl.clear(clear_bits);

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
}


export function startup(params) {
  // globals for leftover Turbulenz bits
  window.TurbulenzEngine = null;
  window.assert = assert;

  canvas = document.getElementById('canvas');

  function resizeCanvas() {
    let css_to_real = window.devicePixelRatio || 1;
    window.pixel_scale = css_to_real;
    canvas.width = Math.round(canvas.clientWidth * css_to_real);
    canvas.height = Math.round(canvas.clientHeight * css_to_real);

    // For the next 10 frames, make sure font size is correct
    need_repos = 10;
  }
  // resize the canvas to fill browser window dynamically
  window.addEventListener('resize', resizeCanvas, false);
  resizeCanvas();

  let is_pixely = params.pixely && params.pixely !== 'off';
  let antialias = params.antialias || !is_pixely && params.antialias !== false;
  let context_names = ['webgl', 'experimental-webgl'];
  let context_opt = { antialias };
  let good = false;
  for (let i = 0; i < context_names.length; i += 1) {
    try {
      window.gl = canvas.getContext(context_names[i], context_opt);
      good = true;
      break;
    } catch (e) {
      // ignore
    }
  }
  if (!good) {
    // eslint-disable-next-line no-alert
    window.alert('Sorry, but your browser does not support WebGL or does not have it enabled.');
    document.getElementById('loading').style.visibility = 'hidden';
    return false;
  }

  assert(gl);
  canvas.focus();
  game_width = params.game_width || 1280;
  game_height = params.game_height || 960;
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
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.clearColor(0, 0.1, 0.2, 1);

  // Use &D=WIREFRAME to set the WIREFRAME define
  let m = document.location.search.match(/D=[^&]+/gu);
  if (m) {
    m.forEach((v) => {
      defines[v.slice(2)] = true;
    });
  }

  textures.startup();
  geom.startup();
  shaders.startup({
    light_diffuse,
    light_dir_vs,
    ambient: light_ambient,
    mat_m: mat_m,
    mat_vp: mat_vp,
    mvp: mat_mvp,
    mv_inv_trans: mat_mv_inv_transform,
    view: mat_view,
    projection: mat_projection,
  });
  camera2d.startup();
  sprites.startup();
  input.startup(canvas);

  // eslint-disable-next-line no-bitwise
  clear_bits = gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT;

  /* eslint-disable global-require */
  glov_particles = require('./particles.js').create();

  if (is_pixely) {
    textures.defaultFilters(gl.NEAREST, gl.NEAREST);
  } else {
    textures.defaultFilters(gl.LINEAR, gl.LINEAR);
  }

  sound_manager = require('./sound_manager.js').create();

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
  glov_ui.bindSounds(sound_manager, { // TODO: Allow overriding?
    button_click: 'button_click',
    rollover: 'rollover',
  });

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

function loading() {
  let load_count = textures.load_count + sound_manager.loading()/* + models.load_count */;
  document.getElementById('loading_text').innerText = `Loading (${load_count})...`;
  if (!load_count) {
    let elem = document.getElementById('loading');
    elem.style.visibility = 'hidden';
    is_loading = false;
    app_state = after_loading_state;
  }
}
app_state = loading;

window.glov_engine = exports;
