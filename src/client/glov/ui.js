/* eslint-env jquery */
/* eslint no-underscore-dangle:off */
/* global Z:false */

window.Z = window.Z || {};
Z.BORDERS = Z.BORDERS || 90;
Z.UI = Z.UI || 100;
Z.MODAL = Z.MODAL || 1000;
Z.TOOLTIP = Z.TOOLTIP || 2000;
Z.DEBUG = Z.DEBUG || 9800;

// very high, but can still add integers
Z.TRANSITION_FINAL = Z.TRANSITION_FINAL || 9900;
// how much Z range can be used for rendering transitions - the capture happens at z + Z_TRANSITION_RANGE
Z.TRANSITION_RANGE = Z.TRANSITION_RANGE || 10;

Z.FPSMETER = Z.FPSMETER || 10000;

const assert = require('assert');
const camera2d = require('./camera2d.js');
const glov_edit_box = require('./edit_box.js');
const effects = require('./effects.js');
const glov_engine = require('./engine.js');
const glov_font = require('./font.js');
const glov_input = require('./input.js');
const { abs, max, min, round, sqrt } = Math;
const glov_sprites = require('./sprites.js');
const textures = require('./textures.js');
const { clone, merge } = require('../../common/util.js');
const { mat43, m43identity, m43mul } = require('./mat43.js');
const { clamp, lerp, vec2, vec4, v4scale } = require('./vmath.js');

const MODAL_DARKEN = 0.75;
let KEYS;
let pad_codes;

const menu_fade_params_default = {
  blur: [0.125, 0.865],
  saturation: [0.5, 0.1],
  brightness: [1, 1 - MODAL_DARKEN],
  fallback_darken: vec4(0, 0, 0, MODAL_DARKEN),
  z: Z.MODAL,
};

export function focuslog(...args) {
  // console.log(`focuslog(${glov_engine.global_frame_index}): `, ...args);
}

export function makeColorSet(color) {
  let ret = {
    regular: vec4(),
    rollover: vec4(),
    down: vec4(),
    disabled: vec4(),
  };
  v4scale(ret.regular, color, 1);
  v4scale(ret.rollover, color, 0.8);
  v4scale(ret.down, color, 0.7);
  v4scale(ret.disabled, color, 0.4);
  for (let field in ret) {
    ret[field][3] = color[3];
  }
  return ret;
}

function doBlurEffect(factor, params) {
  factor = lerp(factor, params.blur[0], params.blur[1]);
  if (factor) {
    effects.applyGaussianBlur({
      source: glov_engine.captureFramebuffer(),
      blur: factor,
      // min_size: 128,
    });
  }
}

let desaturate_xform = mat43();
let desaturate_tmp = mat43();
function doDesaturateEffect(factor, params) {
  let saturation = lerp(factor, params.saturation[0], params.saturation[1]);
  let brightness = lerp(factor, params.brightness[0], params.brightness[1]);
  if (saturation === 1 && brightness === 1) {
    return;
  }
  m43identity(desaturate_xform);

  effects.saturationMatrix(desaturate_tmp, saturation);
  m43mul(desaturate_xform, desaturate_xform, desaturate_tmp);

  effects.brightnessScaleMatrix(desaturate_tmp, brightness);
  m43mul(desaturate_xform, desaturate_xform, desaturate_tmp);

  // if ((hue % (Math.PI * 2)) !== 0) {
  //   effects.hueMatrix(tmp, hue);
  //   m43mul(xform, xform, tmp);
  // }
  // if (contrast !== 1) {
  //   effects.contrastMatrix(tmp, contrast);
  //   m43mul(xform, xform, tmp);
  // }
  // if (brightness !== 0) {
  //   effects.brightnessMatrix(tmp, brightness);
  //   m43mul(xform, xform, tmp);
  // }
  // if (additiveRGB[0] !== 0 || additiveRGB[1] !== 0 || additiveRGB[2] !== 0) {
  //   effects.additiveMatrix(tmp, additiveRGB);
  //   m43mul(xform, xform, tmp);
  // }
  // if (grayscale) {
  //   effects.grayScaleMatrix(tmp);
  //   m43mul(xform, xform, tmp);
  // }
  // if (negative) {
  //   effects.negativeMatrix(tmp);
  //   m43mul(xform, xform, tmp);
  // }
  // if (sepia) {
  //   effects.sepiaMatrix(tmp);
  //   m43mul(xform, xform, tmp);
  // }
  effects.applyColorMatrix({
    colorMatrix: desaturate_xform,
    source: glov_engine.captureFramebuffer(),
  });
}

// overrideable default parameters
export let button_height = 32;
export let font_height = 24;
export let button_width = 200;
export let button_img_size = button_height;
export let modal_width = 600;
export let modal_y0 = 200;
export let modal_title_scale = 1.2;
export let pad = 16;
export let panel_pixel_scale = 32 / 13; // button_height / button pixel resolution
export let tooltip_width = 400;
export let tooltip_pad = 8;

export let font_style_focused = glov_font.style(null, {
  color: 0x000000ff,
  outline_width: 2,
  outline_color: 0xFFFFFFff,
});
export let font_style_normal = glov_font.styleColored(null, 0x000000ff);

export let font;
export let sprites = {};

export let color_button = makeColorSet([1,1,1,1]);
export let color_panel = vec4(1, 1, 0.75, 1);
export let modal_font_style = glov_font.styleColored(null, 0x000000ff);

let sounds = {};
export let button_mouseover = false; // for callers to poll the very last button
export let button_focused = false; // for callers to poll the very last button
export let touch_changed_focus = false; // did a touch even this frame change focus?
// For tracking global mouseover state
let last_frame_button_mouseover = false;
let frame_button_mouseover = false;

let modal_dialog = null;
let modal_stealing_focus = false;
export let menu_up = false; // Boolean to be set by app to impact behavior, similar to a modal
let menu_fade_params = merge({}, menu_fade_params_default);
let menu_up_time = 0;

exports.this_frame_edit_boxes = [];
let last_frame_edit_boxes = [];
let dom_elems = [];
let dom_elems_issued = 0;

// for modal dialogs
let button_keys;

let focused_last_frame;
let focused_this_frame;
let focused_key_not;
let focused_key;
let focused_key_prev1;
let focused_key_prev2;

export function startup(_font, ui_sprites) {
  ui_sprites = ui_sprites || {};
  font = _font;
  KEYS = glov_input.KEYS;
  pad_codes = glov_input.pad_codes;

  function loadUISprite(name, ws, hs, only_override) {
    let override = ui_sprites[name];
    if (override) {
      sprites[name] = glov_sprites.create({
        name: override[0],
        ws: override[1],
        hs: override[2],
      });
    } else if (!only_override) {
      sprites[name] = glov_sprites.create({
        name: `ui/${name}`,
        ws,
        hs,
      });
    }
  }

  loadUISprite('button', [4, 5, 4], [13]);
  sprites.button_regular = sprites.button;
  loadUISprite('button_rollover', [4, 5, 4], [13], true);
  loadUISprite('button_down', [4, 5, 4], [13]);
  loadUISprite('button_disabled', [4, 5, 4], [13]);
  loadUISprite('panel', [3, 2, 3], [3, 10, 3]);
  loadUISprite('menu_entry', [4, 5, 4], [13]);
  loadUISprite('menu_selected', [4, 5, 4], [13]);
  loadUISprite('menu_down', [4, 5, 4], [13]);
  loadUISprite('menu_header', [4, 5, 12], [13]);
  loadUISprite('slider', [6, 2, 6], [13]);
  // loadUISprite('slider_notch', [3], [13]);
  loadUISprite('slider_handle', [9], [13]);

  sprites.white = glov_sprites.create({ url: 'white' });

  button_keys = {
    ok: { key: [], pad: [pad_codes.X] },
    cancel: { key: [KEYS.ESC], pad: [pad_codes.B, pad_codes.Y] },
  };
  button_keys.yes = clone(button_keys.ok);
  button_keys.yes.key.push(KEYS.Y);
  button_keys.no = clone(button_keys.cancel);
  button_keys.no.key.push(KEYS.N);
}

let dynamic_text_elem;
export function getElem() {
  if (modal_dialog) {
    return null;
  }
  if (dom_elems_issued >= dom_elems.length) {
    let elem = document.createElement('div');
    elem.setAttribute('class', 'glovui_dynamic');
    if (!dynamic_text_elem) {
      dynamic_text_elem = document.getElementById('dynamic_text');
    }
    dynamic_text_elem.appendChild(elem);
    dom_elems.push(elem);
  }
  let elem = dom_elems[dom_elems_issued];
  dom_elems_issued++;
  return elem;
}

let sound_manager;
export function bindSounds(_sound_manager, _sounds) {
  sound_manager = _sound_manager;
  sounds = _sounds;
  for (let key in sounds) {
    sound_manager.loadSound(sounds[key]);
  }
}

export function drawHBox(coords, s, color) {
  let uidata = s.uidata;
  let ws = [uidata.wh[0] * coords.h, 0, uidata.wh[2] * coords.h];
  let x = coords.x;
  ws[1] = max(0, coords.w - ws[0] - ws[2]);
  for (let ii = 0; ii < ws.length; ++ii) {
    let my_w = ws[ii];
    s.draw({
      x,
      y: coords.y,
      z: coords.z,
      color,
      w: my_w,
      h: coords.h,
      uvs: uidata.rects[ii],
    });
    x += my_w;
  }
}

export function drawBox(coords, s, pixel_scale, color) {
  let uidata = s.uidata;
  let scale = pixel_scale;
  let ws = [uidata.widths[0] * scale, 0, uidata.widths[2] * scale];
  ws[1] = max(0, coords.w - ws[0] - ws[2]);
  let hs = [uidata.heights[0] * scale, 0, uidata.heights[2] * scale];
  hs[1] = max(0, coords.h - hs[0] - hs[2]);
  let x = coords.x;
  for (let ii = 0; ii < ws.length; ++ii) {
    let my_w = ws[ii];
    if (my_w) {
      let y = coords.y;
      for (let jj = 0; jj < hs.length; ++jj) {
        let my_h = hs[jj];
        if (my_h) {
          s.draw({
            x, y, z: coords.z,
            color,
            w: my_w,
            h: my_h,
            uvs: uidata.rects[jj * 3 + ii],
          });
          y += my_h;
        }
      }
      x += my_w;
    }
  }
}

export function playUISound(name) {
  if (name === 'select') {
    name = 'button_click';
  }
  if (sounds[name] && sound_manager) {
    sound_manager.play(sounds[name]);
  }
}

export function setMouseOver(key) {
  if (last_frame_button_mouseover !== key && frame_button_mouseover !== key) {
    playUISound('rollover');
  }
  frame_button_mouseover = key;
  button_mouseover = true;
}

export function focusSteal(key) {
  if (key !== focused_key) {
    focuslog('focusSteal ', key);
  }
  focused_this_frame = true;
  focused_key = key;
}

export function focusCanvas() {
  focusSteal('canvas');
}

export function isFocusedPeek(key) {
  return focused_key === key;
}
export function isFocused(key) {
  if (key !== focused_key_prev2) {
    focused_key_prev1 = focused_key_prev2;
    focused_key_prev2 = key;
  }
  if (key === focused_key || key !== focused_key_not && !focused_this_frame &&
    !focused_last_frame
  ) {
    if (key !== focused_key) {
      focuslog('isFocused->focusSteal');
    }
    focusSteal(key);
    return true;
  }
  return false;
}

export function focusNext(key) {
  focuslog('focusNext ', key);
  playUISound('rollover');
  focused_key = null;
  focused_last_frame = focused_this_frame = false;
  focused_key_not = key;
  // Eat input events so a pair of keys (e.g. SDLK_DOWN and SDLK_CONTROLLER_DOWN)
  // don't get consumed by two separate widgets
  glov_input.eatAllInput();
}

export function focusPrev(key) {
  focuslog('focusPrev ', key);
  playUISound('rollover');
  if (key === focused_key_prev2) {
    focusSteal(focused_key_prev1);
  } else {
    focusSteal(focused_key_prev2);
  }
  glov_input.eatAllInput();
}

export function focusCheck(key) {
  if (modal_stealing_focus) {
    // hidden by modal, etc
    return false;
  }
  // Returns true even if focusing previous element, since for this frame, we are still effectively focused!
  let focused = isFocused(key);
  if (focused) {
    if (glov_input.keyDownEdge(KEYS.TAB)) {
      if (glov_input.keyDown(KEYS.SHIFT)) {
        focusPrev(key);
      } else {
        focusNext(key);
        focused = false;
      }
    }
    if (glov_input.padButtonDownEdge(pad_codes.RIGHT_BUMPER)) {
      focusNext(key);
      focused = false;
    }
    if (glov_input.padButtonDownEdge(pad_codes.LEFT_BUMPER)) {
      focusPrev(key);
    }
  }
  return focused;
}

export function panel(param) {
  assert(typeof param.x === 'number');
  assert(typeof param.y === 'number');
  assert(typeof param.w === 'number');
  assert(typeof param.h === 'number');
  param.z = param.z || (Z.UI - 1);
  let color = param.color || color_panel;
  drawBox(param, sprites.panel, panel_pixel_scale, color);
  glov_input.click(param);
  glov_input.mouseOver(param);
}

export function drawTooltip(param) {
  assert(typeof param.x === 'number');
  assert(typeof param.y === 'number');
  assert(typeof param.tooltip === 'string');

  let tooltip_w = param.tooltip_width || tooltip_width;
  let x = param.x;
  if (x + tooltip_w > camera2d.x1()) {
    x = camera2d.x1() - tooltip_w;
  }
  let z = param.z || Z.TOOLTIP;
  let tooltip_y0 = param.y;
  let eff_tooltip_pad = param.tooltip_pad || tooltip_pad;
  let y = tooltip_y0 + eff_tooltip_pad;
  y += font.drawSizedWrapped(modal_font_style,
    x + eff_tooltip_pad, y, z+1, tooltip_w - eff_tooltip_pad * 2, 0, font_height,
    param.tooltip);
  y += eff_tooltip_pad;

  panel({
    x,
    y: tooltip_y0,
    z,
    w: tooltip_w,
    h: y - tooltip_y0,
  });
}

// eslint-disable-next-line complexity
export function buttonShared(param) {
  let state = 'regular';
  let ret = false;
  let key = param.key || `${param.x}_${param.y}`;
  let focused = !param.disabled && !param.no_focus && focusCheck(key);
  button_mouseover = false;
  if (param.disabled) {
    glov_input.mouseOver(param); // Still eat mouse events
    state = 'disabled';
  } else if (glov_input.click(param)) {
    if (!param.no_touch_mouseover || !glov_input.mousePosIsTouch()) {
      setMouseOver(key);
    }
    if (param.touch_twice && glov_input.mousePosIsTouch() && !focused) {
      // Just focus, show tooltip
      touch_changed_focus = true;
    } else {
      ret = true;
    }
    if (!param.no_focus) {
      focusSteal(key);
      focused = true;
    }
  } else if (glov_input.mouseOver(param)) {
    if (param.no_touch_mouseover && glov_input.mousePosIsTouch()) {
      // do not set mouseover
    } else if (param.touch_twice && !focused && glov_input.mousePosIsTouch()) {
      // do not set mouseover
    } else {
      setMouseOver(key);
      state = glov_input.mouseDown() ? 'down' : 'rollover';
    }
  }
  button_focused = focused;
  if (focused) {
    if (glov_input.keyDownEdge(KEYS.SPACE) || glov_input.keyDownEdge(KEYS.RETURN) ||
      glov_input.padButtonDownEdge(pad_codes.A)
    ) {
      ret = true;
    }
  }
  if (ret) {
    state = 'down';
    playUISound('button_click');
  }
  if (button_mouseover && param.tooltip) {
    drawTooltip({
      x: param.x,
      y: param.tooltip_above ? param.y - font_height * 2 - 16 : param.y + param.h + 2,
      tooltip: param.tooltip,
      tooltip_width: param.tooltip_width,
    });
  }
  return { ret, state, focused };
}

export function buttonTextDraw(param, state, focused) {
  let colors = param.colors || color_button;
  let color = colors[state];
  let sprite_name = `button_${state}`;
  let sprite = sprites[sprite_name];
  if (sprite) { // specific sprite, use regular colors
    color = colors.regular;
  } else {
    sprite = sprites.button;
  }

  drawHBox(param, sprite, color);
  font.drawSizedAligned(
    focused ? font_style_focused : font_style_normal,
    param.x, param.y, param.z + 0.1,
    // eslint-disable-next-line no-bitwise
    param.font_height, glov_font.ALIGN.HCENTERFIT | glov_font.ALIGN.VCENTER, param.w, param.h, param.text);
}

export function buttonText(param) {
  // required params
  assert(typeof param.x === 'number');
  assert(typeof param.y === 'number');
  assert(typeof param.text === 'string');
  // optional params
  param.z = param.z || Z.UI;
  param.w = param.w || button_width;
  param.h = param.h || button_height;
  param.font_height = param.font_height || font_height;

  let { ret, state, focused } = buttonShared(param);
  buttonTextDraw(param, state, focused);
  return ret;
}

export function buttonImage(param) {
  // required params
  assert(typeof param.x === 'number');
  assert(typeof param.y === 'number');
  assert(param.img && param.img.draw); // should be a sprite
  // optional params
  param.z = param.z || Z.UI;
  param.w = param.w || button_img_size;
  param.h = param.h || param.w || button_img_size;
  param.shrink = param.shrink || 0.75;
  //param.img_rect; null -> full image
  let uvs = param.img_rect || (typeof param.frame === 'number' ? param.img.uidata.rects[param.frame] : null);

  let { ret, state } = buttonShared(param);
  let colors = param.colors || color_button;
  let color = colors[state];

  drawHBox(param, sprites.button, color);
  let img_w = param.img.size[0];
  let img_h = param.img.size[1];
  let img_origin = param.img.origin;
  let img_scale = min(param.w * param.shrink / img_w, param.h * param.shrink / img_h);
  img_w *= img_scale;
  img_h *= img_scale;
  let draw_param = {
    x: param.x + (param.w - img_w) / 2 + img_origin[0] * img_w,
    y: param.y + (param.h - img_h) / 2 + img_origin[1] * img_h,
    z: param.z + 0.1,
    color,
    color1: param.color1,
    w: img_scale,
    h: img_scale,
    uvs,
    rot: param.rotation,
  };
  if (param.color1) {
    param.img.drawDualTint(draw_param);
  } else {
    param.img.draw(draw_param);
  }
  return ret;
}

export function print(style, x, y, z, text) {
  return font.drawSized(style, x, y, z, font_height, text);
}

// Note: modal dialogs not really compatible with HTML overlay on top of the canvas!
export function modalDialog(params) {
  assert(!params.title || typeof params.title === 'string');
  assert(!params.text || typeof params.text === 'string');
  assert(typeof params.buttons === 'object');
  assert(Object.keys(params.buttons).length);

  modal_dialog = params;
}

function modalDialogRun() {
  const eff_button_width = modal_dialog.button_width || round(button_width / 2);
  const game_width = camera2d.x1() - camera2d.x0();
  const text_w = modal_width - pad * 2;
  const x0 = camera2d.x0() + round((game_width - modal_width) / 2);
  let x = x0 + pad;
  const y0 = modal_y0;
  let y = y0 + pad;
  let eff_font_height = modal_dialog.font_height || font_height;

  if (modal_dialog.title) {
    y += font.drawSizedWrapped(modal_font_style,
      x, y, Z.MODAL, text_w, 0, eff_font_height * modal_title_scale,
      modal_dialog.title);
    y += round(pad * 1.5);
  }

  if (modal_dialog.text) {
    y += font.drawSizedWrapped(modal_font_style, x, y, Z.MODAL, text_w, 0, eff_font_height,
      modal_dialog.text);
    y += pad;
  }

  let buttons = modal_dialog.buttons;
  let keys = Object.keys(buttons);
  x = x0 + modal_width - pad - eff_button_width - (pad + eff_button_width) * (keys.length - 1);
  for (let ii = 0; ii < keys.length; ++ii) {
    let key = keys[ii];
    let eff_button_keys = button_keys[key.toLowerCase()];
    let pressed = false;
    if (eff_button_keys) {
      for (let jj = 0; jj < eff_button_keys.key.length; ++jj) {
        pressed = pressed || glov_input.keyDownEdge(eff_button_keys.key[jj]);
      }
      for (let jj = 0; jj < eff_button_keys.pad.length; ++jj) {
        pressed = pressed || glov_input.padButtonDownEdge(eff_button_keys.pad[jj]);
      }
    }
    if (pressed) {
      playUISound('button_click');
    }
    if (buttonText({
      x: x,
      y,
      z: Z.MODAL,
      w: eff_button_width,
      h: button_height,
      text: key
    }) || pressed
    ) {
      modal_dialog = null;
      if (buttons[key]) {
        buttons[key]();
      }
    }
    x += pad + eff_button_width;
  }
  y += button_height;
  y += pad * 2;
  panel({
    x: x0,
    y: y0,
    z: Z.MODAL - 1,
    w: modal_width,
    h: y - y0,
  });

  glov_input.eatAllInput();
  modal_stealing_focus = true;
}

export function createEditBox(params) {
  return glov_edit_box.create(params);
}

const color_slider_handle = vec4(1,1,1,1);
const color_slider_handle_grab = vec4(0.5,0.5,0.5,1);
const color_slider_handle_over = vec4(0.75,0.75,0.75,1);
// Returns new value
export function slider(value, param) {
  // required params
  assert(typeof param.x === 'number');
  assert(typeof param.y === 'number');
  assert(param.min < param.max); // also must be numbers
  // optional params
  param.z = param.z || Z.UI;
  param.w = param.w || button_width;
  param.h = param.h || button_height;
  let disabled = param.disabled || false;

  drawHBox(param, sprites.slider, param.color);

  let xoffs = round(sprites.slider.uidata.wh[0] * param.h / 2);
  let draggable_width = param.w - xoffs * 2;

  // Draw notches - would also need to quantize the values below
  // if (!slider->no_notches) {
  //   float space_for_notches = width - xoffs * 4;
  //   int num_notches = max - 1;
  //   float notch_w = tile_scale * glov_ui_slider_notch->GetTileWidth();
  //   float notch_h = tile_scale * glov_ui_slider_notch->GetTileHeight();
  //   float max_notches = space_for_notches / (notch_w + 2);
  //   int notch_inc = 1;
  //   if (num_notches > max_notches)
  //     notch_inc = ceil(num_notches / floor(max_notches));

  //   for (int ii = 1; ii*notch_inc <= num_notches; ii++) {
  //     float notch_x_mid = x + xoffs + draggable_width * ii * notch_inc / (float)max;
  //     if (notch_x_mid - notch_w/2 < x + xoffs * 2)
  //       continue;
  //     if (notch_x_mid + notch_w/2 > x + width - xoffs * 2)
  //       continue;
  //     glov_ui_slider_notch->DrawStretchedColor(notch_x_mid - notch_w / 2, y + yoffs,
  //       z + 0.25, notch_w, notch_h, 0, color);
  //   }
  // }

  // Handle
  let drag = !disabled && glov_input.drag(param);
  let grabbed = Boolean(drag);
  let click = glov_input.click(param);
  if (click) {
    grabbed = false;
    // update pos
    value = (click.pos[0] - (param.x + xoffs)) / draggable_width;
    value = param.min + (param.max - param.min) * clamp(value, 0, 1);
    playUISound('button_click');
  } else if (grabbed) {
    // update pos
    value = (drag.cur_pos[0] - (param.x + xoffs)) / draggable_width;
    value = param.min + (param.max - param.min) * clamp(value, 0, 1);
    // Eat all mouseovers while dragging
    glov_input.mouseOver();
  }
  let rollover = !disabled && glov_input.mouseOver(param);
  let handle_center_pos = param.x + xoffs + draggable_width * (value - param.min) / param.max;
  let handle_h = param.h;
  let handle_w = sprites.slider_handle.uidata.wh[0] * handle_h;
  let handle_x = handle_center_pos - handle_w / 2;
  let handle_y = param.y + param.h / 2 - handle_h / 2;
  let handle_color = color_slider_handle;
  if (grabbed) {
    handle_color = color_slider_handle_grab;
  } else if (rollover) {
    handle_color = color_slider_handle_over;
  }

  sprites.slider_handle.draw({
    x: handle_x,
    y: handle_y,
    z: param.z + 0.1,
    w: handle_w,
    h: handle_h,
    color: handle_color,
    frame: 0,
  });

  return value;
}

let bad_frames = 0;
export function tick(dt) {
  last_frame_button_mouseover = frame_button_mouseover;
  frame_button_mouseover = false;
  focused_last_frame = focused_this_frame;
  focused_this_frame = false;
  focused_key_not = null;
  modal_stealing_focus = false;
  touch_changed_focus = false;

  for (let ii = 0; ii < last_frame_edit_boxes.length; ++ii) {
    let edit_box = last_frame_edit_boxes[ii];
    let idx = exports.this_frame_edit_boxes.indexOf(edit_box);
    if (idx === -1) {
      edit_box.unrun();
    }
  }
  last_frame_edit_boxes = exports.this_frame_edit_boxes;
  exports.this_frame_edit_boxes = [];

  while (dom_elems_issued < dom_elems.length) {
    let elem = dom_elems.pop();
    dynamic_text_elem.removeChild(elem);
  }
  dom_elems_issued = 0;

  let pp_this_frame = false;
  if (modal_dialog || menu_up) {
    let params = menu_fade_params;
    if (!menu_up) {
      // Modals get defaults
      params = menu_fade_params_default;
    }
    menu_up_time += dt;
    // Effects during modal dialogs
    if (glov_engine.postprocessing) {
      let factor = min(menu_up_time / 500, 1);
      glov_sprites.queuefn(params.z - 2, doBlurEffect.bind(null, factor, params));
      glov_sprites.queuefn(params.z - 1, doDesaturateEffect.bind(null, factor, params));
      pp_this_frame = true;
    } else {
      // Just darken
      sprites.white.draw({
        x: camera2d.x0(),
        y: camera2d.y0(),
        z: params.z - 2,
        color: params.fallback_darken,
        w: camera2d.x1() - camera2d.x0(),
        h: camera2d.y1() - camera2d.y0(),
      });
    }
  } else {
    menu_up_time = 0;
  }
  menu_up = false;

  if (!glov_engine.is_loading && glov_engine.this_frame_time > 250 && pp_this_frame) {
    bad_frames++;
    if (bad_frames >= 3) { // 3 in a row, disable superfluous postprocessing
      glov_engine.postprocessingAllow(false);
    }
  } else if (bad_frames) {
    bad_frames = 0;
  }

  if (modal_dialog) {
    modalDialogRun();
  }
}

export function endFrame() {
  if (glov_input.click({
    x: -Infinity, y: -Infinity,
    w: Infinity, h: Infinity,
  })) {
    focusSteal('canvas');
  }
}

export function menuUp(params) {
  merge(menu_fade_params, menu_fade_params_default);
  if (params) {
    merge(menu_fade_params, params);
  }
  menu_up = true;
  modal_stealing_focus = true;
  glov_input.eatAllInput();
}

export function drawRect(x0, y0, x1, y1, z, color) {
  let mx = min(x0, x1);
  let my = min(y0, y1);
  let Mx = max(x0, x1);
  let My = max(y0, y1);
  sprites.white.draw({
    x: mx,
    y: my,
    z,
    color,
    w: Mx - mx,
    h: My - my,
  });
}

function spreadTechParams(spread) {
  // spread=0 -> 1
  // spread=0.5 -> 2
  // spread=0.75 -> 4
  // spread=1 -> large enough to AA
  spread = min(max(spread, 0), 0.99);

  let tech_params = {
    param0: vec4(0,0,0,0),
  };

  tech_params.param0[0] = 1 / (1 - spread);
  tech_params.param0[1] = -0.5 * tech_params.param0[0] + 0.5;
  return tech_params;
}

function drawCircleInternal(sprite, x, y, z, r, spread, tu1, tv1, tu2, tv2, color) {
  let x0 = x - r * 2 + r * 4 * tu1;
  let x1 = x - r * 2 + r * 4 * tu2;
  let y0 = y - r * 2 + r * 4 * tv1;
  let y1 = y - r * 2 + r * 4 * tv2;
  glov_sprites.queueraw(sprite.texs,
    x0, y0, z, x1 - x0, y1 - y0,
    tu1, tv1, tu2, tv2,
    color, glov_font.font_shaders.font_aa, spreadTechParams(spread));
}

export function drawCircle(x, y, z, r, spread, color) {
  if (!sprites.circle) {
    const CIRCLE_SIZE = 32;
    let data = new Uint8Array(CIRCLE_SIZE*CIRCLE_SIZE);
    let midp = (CIRCLE_SIZE - 1) / 2;
    for (let i = 0; i < CIRCLE_SIZE; i++) {
      for (let j = 0; j < CIRCLE_SIZE; j++) {
        let d = sqrt((i - midp)*(i - midp) + (j - midp)*(j - midp)) / midp;
        let v = clamp(1 - d, 0, 1);
        data[i + j*CIRCLE_SIZE] = v * 255;
      }
    }
    sprites.circle = glov_sprites.create({
      url: 'circle',
      width: CIRCLE_SIZE, height: CIRCLE_SIZE,
      format: textures.format.R8,
      data,
      filter_min: gl.LINEAR,
      filter_max: gl.LINEAR,
      wrap_s: gl.CLAMP_TO_EDGE,
      wrap_t: gl.CLAMP_TO_EDGE,
      origin: vec2(0.5, 0.5),
    });
  }
  drawCircleInternal(sprites.circle, x, y, z, r, spread, 0, 0, 1, 1, color);
}

export function drawHollowCircle(x, y, z, r, spread, color) {
  if (!sprites.hollow_circle) {
    const CIRCLE_SIZE = 128;
    const LINE_W = 2;
    let data = new Uint8Array(CIRCLE_SIZE*CIRCLE_SIZE);
    let midp = (CIRCLE_SIZE - 1) / 2;
    for (let i = 0; i < CIRCLE_SIZE; i++) {
      for (let j = 0; j < CIRCLE_SIZE; j++) {
        let d = sqrt((i - midp)*(i - midp) + (j - midp)*(j - midp)) / midp;
        let v = clamp(1 - d, 0, 1);
        if (v > 0.5) {
          v = 1 - v;
        }
        v += (LINE_W / CIRCLE_SIZE);
        data[i + j*CIRCLE_SIZE] = v * 255;
      }
    }
    sprites.hollow_circle = glov_sprites.create({
      url: 'hollow_circle',
      width: CIRCLE_SIZE, height: CIRCLE_SIZE,
      format: textures.format.R8,
      data,
      filter_min: gl.LINEAR,
      filter_max: gl.LINEAR,
      wrap_s: gl.CLAMP_TO_EDGE,
      wrap_t: gl.CLAMP_TO_EDGE,
      origin: vec2(0.5, 0.5),
    });
  }
  drawCircleInternal(sprites.hollow_circle, x, y, z, r, spread, 0, 0, 1, 1, color);
}

export function drawLine(x0, y0, x1, y1, z, w, spread, color) {
  if (!sprites.line) {
    const LINE_SIZE=32;
    let data = new Uint8Array(LINE_SIZE*LINE_SIZE);
    let midp = (LINE_SIZE - 1) / 2;
    for (let i = 0; i < LINE_SIZE; i++) {
      for (let j = 0; j < LINE_SIZE; j++) {
        let d = abs((i - midp) / midp);
        let v = clamp(1 - d, 0, 1);
        data[i + j*LINE_SIZE] = v * 255;
      }
    }
    sprites.line = glov_sprites.create({
      url: 'line',
      width: LINE_SIZE, height: LINE_SIZE,
      format: textures.format.R8,
      data,
      filter_min: gl.LINEAR,
      filter_max: gl.LINEAR,
      wrap_s: gl.CLAMP_TO_EDGE,
      wrap_t: gl.CLAMP_TO_EDGE,
      origin: vec2(0.5, 0.5),
    });
  }

  let dx = x1 - x0;
  let dy = y1 - y0;
  let length = Math.sqrt(dx*dx + dy*dy);
  dx /= length;
  dy /= length;
  let tangx = -dy * w;
  let tangy = dx * w;

  glov_sprites.queueraw4(sprites.line.texs,
    x0 + tangx, y0 + tangy,
    x1 + tangx, y1 + tangy,
    x1 - tangx, y1 - tangy,
    x0 - tangx, y0 - tangy,
    z,
    0, 0, 1, 1,
    color, glov_font.font_shaders.font_aa, spreadTechParams(spread));
}

export function drawCone(x0, y0, x1, y1, z, w0, w1, spread, color) {
  if (!sprites.cone) {
    const CONE_SIZE = 32;
    let data = new Uint8Array(CONE_SIZE*CONE_SIZE);
    let midp = (CONE_SIZE - 1) / 2;
    for (let i = 0; i < CONE_SIZE; i++) {
      for (let j = 0; j < CONE_SIZE; j++) {
        let dx = 0;
        let dy = 0;
        let d = 0;
        if (i > midp) {
          dx = (i - midp) / midp;
          dy = abs(j - midp) / midp;
          let dCircle = sqrt(dx*dx + dy*dy);
          d = dx * dCircle;
        }
        let v = clamp(1 - d, 0, 1);
        data[i + j*CONE_SIZE] = v * 255;
      }
    }
    sprites.cone = glov_sprites.create({
      url: 'cone',
      width: CONE_SIZE, height: CONE_SIZE,
      format: textures.format.R8,
      data,
      filter_min: gl.LINEAR,
      filter_max: gl.LINEAR,
      wrap_s: gl.CLAMP_TO_EDGE,
      wrap_t: gl.CLAMP_TO_EDGE,
      origin: vec2(0.5, 0.5),
    });
  }
  let dx = x1 - x0;
  let dy = y1 - y0;
  let length = Math.sqrt(dx*dx + dy*dy);
  dx /= length;
  dy /= length;
  let tangx = -dy;
  let tangy = dx;
  glov_sprites.queueraw4(sprites.cone.texs,
    x0 - tangx*w0, y0 - tangy*w0,
    x0 + tangx*w0, y0 + tangy*w0,
    x1 + tangx*w1, y1 + tangy*w1,
    x1 - tangx*w1, y1 - tangy*w1,
    z,
    0, 0, 1, 1,
    color, glov_font.font_shaders.font_aa, spreadTechParams(spread));
}

export function scaleSizes(scale) {
  button_height = round(32 * scale);
  font_height = round(24 * scale);
  button_width = round(200 * scale);
  button_img_size = button_height;
  modal_width = round(600 * scale);
  modal_y0 = round(200 * scale);
  modal_title_scale = 1.2;
  pad = round(16 * scale);
  tooltip_width = round(400 * scale);
  tooltip_pad = round(8 * scale);
  panel_pixel_scale = button_height / 13; // button_height / button pixel resolution
}

export function setFontHeight(_font_height) {
  font_height = _font_height;
}

scaleSizes(1);
