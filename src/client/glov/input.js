// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
// Some code from Turbulenz: Copyright (c) 2012-2013 Turbulenz Limited
// Released under MIT License: https://opensource.org/licenses/MIT
/* global navigator */

const assert = require('assert');
const camera2d = require('./camera2d.js');
const local_storage = require('./local_storage.js');
const glov_engine = require('./engine.js');
const { abs, min, sqrt } = Math;
const { vec2, v2add, v2copy, v2lengthSq, v2set, v2scale, v2sub } = require('./vmath.js');

const UP_EDGE = 0;
const DOWN_EDGE = 1;
const DOWN = 2;

// per-app overrideable options
const TOUCH_AS_MOUSE = true;
const MAP_ANALOG_TO_DPAD = true;

export const ANY = -2;
export const POINTERLOCK = -1;

export const KEYS = {
  BACKSPACE: 8,
  TAB: 9,
  ENTER: 13,
  RETURN: 13,
  SHIFT: 16,
  CTRL: 17,
  ALT: 18,
  ESC: 27,
  ESCAPE: 27,
  SPACE: 32,
  PAGEUP: 33,
  PAGEDOWN: 34,
  END: 35,
  HOME: 36,
  LEFT: 37,
  UP: 38,
  RIGHT: 39,
  DOWN: 40,
  INS: 45,
  DEL: 46,
};
(function () {
  for (let ii = 1; ii <= 12; ++ii) {
    KEYS[`F${ii}`] = 111 + ii;
  }
  for (let ii = 48; ii <= 90; ++ii) { // 0-9;A-Z
    KEYS[String.fromCharCode(ii)] = ii;
  }
}());
export const pad_codes = {
  A: 0,
  SELECT: 0, // GLOV name
  B: 1,
  CANCEL: 1, // GLOV name
  X: 2,
  Y: 3,
  LB: 4,
  LEFT_BUMPER: 4,
  RB: 5,
  RIGHT_BUMPER: 5,
  LT: 6,
  LEFT_TRIGGER: 6,
  RT: 7,
  RIGHT_TRIGGER: 7,
  BACK: 8,
  START: 9,
  LEFT_STICK: 10,
  RIGHT_STICK: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
  ANALOG_UP: 20,
  ANALOG_LEFT: 21,
  ANALOG_DOWN: 22,
  ANALOG_RIGHT: 23,
};

let canvas;
let key_state = {};
let pad_states = []; // One map per gamepad to pad button states
let gamepad_data = []; // Other tracking data per gamepad
let mouse_pos = vec2();
let last_mouse_pos = vec2();
let mouse_pos_is_touch = false;
let mouse_over_captured = false;
let mouse_down = [];
let mouse_wheel = 0;

let input_eaten_kb = false;
let input_eaten_mouse = false;

let touches = {}; // `m${button}` or touch_id -> TouchData

export let touch_mode = local_storage.getJSON('touch_mode', false);

function TouchData(pos, touch, button) {
  this.delta = vec2();
  this.total = 0;
  this.cur_pos = pos.slice(0);
  this.start_pos = pos.slice(0);
  this.release = false;
  this.touch = touch;
  this.button = button;
  this.start_time = Date.now();
  this.dispatched = false;
  this.state = DOWN_EDGE;
}

export function pointerLocked() {
  return document.pointerLockElement || document.mozPointerLockElement || document.webkitPointerLockElement;
}
let pointerlock_touch_id = `m${POINTERLOCK}`;
export function pointerLockEnter() {
  let touch_data = touches[pointerlock_touch_id];
  if (touch_data) {
    v2copy(touch_data.start_pos, mouse_pos);
    touch_data.release = false;
  } else {
    touch_data = touches[pointerlock_touch_id] = new TouchData(mouse_pos, false, POINTERLOCK);
    touch_data.state = DOWN; // No DOWN_EDGE for this
  }
  return canvas.requestPointerLock && canvas.requestPointerLock();
}
export function pointerLockExit() {
  let touch_data = touches[pointerlock_touch_id];
  if (touch_data) {
    v2copy(touch_data.cur_pos, mouse_pos);
    touch_data.state = null; // no UP_EDGE for this
    touch_data.release = true;
  }
  document.exitPointerLock();
}

function ignored(event) {
  event.preventDefault();
  event.stopPropagation();
}

function onKeyUp(event) {
  let code = event.keyCode;
  if (event.target.tagName !== 'INPUT') {
    event.stopPropagation();
    event.preventDefault();
  }

  if (code === KEYS.ESC && pointerLocked()) {
    pointerLockExit();
  }
  key_state[code] = UP_EDGE;
}

function onKeyDown(event) {
  let code = event.keyCode;
  if (code !== KEYS.F12 && code !== KEYS.F5 && code !== KEYS.F6 && event.target.tagName !== 'INPUT') {
    event.stopPropagation();
    event.preventDefault();
  }
  // console.log(`${event.code} ${event.keyCode}`);
  key_state[code] = DOWN_EDGE;
}

let temp_delta = vec2();
function onMouseMove(event, no_stop) {
  if (touch_mode) {
    local_storage.setJSON('touch_mode', false);
    touch_mode = false;
  }
  if (event.target.tagName !== 'INPUT' && !no_stop) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (event.offsetX !== undefined) {
    mouse_pos[0] = event.offsetX;
    mouse_pos[1] = event.offsetY;
  } else {
    mouse_pos[0] = event.layerX;
    mouse_pos[1] = event.layerY;
  }
  mouse_pos_is_touch = false;

  let any_movement = false;
  if (pointerLocked()) {
    if (event.movementX || event.movementY) {
      v2set(temp_delta, event.movementX, event.movementY);
      any_movement = true;
    }
  } else {
    v2sub(temp_delta, mouse_pos, last_mouse_pos);
    if (temp_delta[0] || temp_delta[1]) {
      any_movement = true;
    }
  }
  if (any_movement) {
    for (let button = POINTERLOCK; button < mouse_down.length; ++button) {
      if (mouse_down[button] || button === POINTERLOCK && pointerLocked()) {
        let touch_data = touches[`m${button}`];
        if (touch_data) {
          v2add(touch_data.delta, touch_data.delta, temp_delta);
          touch_data.total += abs(temp_delta[0]) + abs(temp_delta[1]);
          v2copy(touch_data.cur_pos, mouse_pos);
        }
      }
    }
  }
  v2copy(last_mouse_pos, mouse_pos);
}

function onMouseDown(event) {
  onMouseMove(event); // update mouse_pos
  glov_engine.sound_manager.resume();
  let no_click = event.target.tagName === 'INPUT';

  let button = event.button;
  mouse_down[button] = mouse_pos.slice(0);
  let touch_id = `m${button}`;
  if (touches[touch_id]) {
    v2copy(touches[touch_id].start_pos, mouse_pos);
    touches[touch_id].release = false;
  } else {
    touches[touch_id] = new TouchData(mouse_pos, false, button);
    if (no_click) {
      touches[touch_id].state = DOWN; // no edge
    }
  }
}

function onMouseUp(event) {
  onMouseMove(event); // update mouse_pos
  let no_click = event.target.tagName === 'INPUT';
  let button = event.button;
  if (mouse_down[button]) {
    let touch_id = `m${button}`;
    let touch_data = touches[touch_id];
    if (touch_data) {
      v2copy(touch_data.cur_pos, mouse_pos);
      if (!no_click) {
        touch_data.state = UP_EDGE;
      }
      touch_data.release = true;
    }
    delete mouse_down[button];
  }
}

function onWheel(event) {
  onMouseMove(event, true);
  if (event.wheelDelta > 0) {
    mouse_wheel++;
  } else if (event.wheelDelta < 0) {
    mouse_wheel--;
  }
}

let touch_pos = vec2();
function onTouchChange(event) {
  glov_engine.sound_manager.resume();
  if (!touch_mode) {
    local_storage.set('touch_mode', true);
    touch_mode = true;
  }
  if (event.cancelable !== false) {
    event.preventDefault();
  }
  let ct = event.touches;
  let seen = {};

  let new_count = ct.length;
  let old_count = new_count;
  // Look for press and movement
  for (let ii = 0; ii < new_count; ++ii) {
    let touch = ct[ii];
    let last_touch = touches[touch.identifier];
    v2set(touch_pos, touch.clientX, touch.clientY);
    if (!last_touch) {
      last_touch = touches[touch.identifier] = new TouchData(touch_pos, true, 0);
      --old_count;
    } else {
      v2sub(temp_delta, touch_pos, last_touch.cur_pos);
      v2add(last_touch.delta, last_touch.delta, temp_delta);
      last_touch.total += abs(temp_delta[0]) + abs(temp_delta[1]);
      v2copy(last_touch.cur_pos, touch_pos);
    }
    seen[touch.identifier] = true;
    if (TOUCH_AS_MOUSE && new_count === 1) {
      // Single touch, treat as mouse movement
      v2copy(mouse_pos, touch_pos);
      mouse_pos_is_touch = true;
    }
  }
  // Look for release, if releasing exactly one final touch
  let released_touch;
  for (let id in touches) {
    if (!seen[id]) {
      let touch = touches[id];
      if (touch.touch) {
        ++old_count;
        released_touch = touch;
        touch.state = UP_EDGE;
        touch.release = true;
      }
    }
  }
  if (TOUCH_AS_MOUSE) {
    if (old_count === 1 && new_count === 0) {
      delete mouse_down[0];
      v2copy(mouse_pos, released_touch.cur_pos);
      mouse_pos_is_touch = true;
    } else if (new_count === 1) {
      let touch = ct[0];
      if (!old_count) {
        mouse_down[0] = vec2(touch.clientX, touch.clientY);
      }
      v2set(mouse_pos, touch.clientX, touch.clientY);
      mouse_pos_is_touch = true;
    } else if (new_count > 1) {
      // multiple touches, release mouse_down without emitting click
      delete mouse_down[0];
    }
  }
}

export function startup(_canvas) {
  canvas = _canvas;

  let passive_param = false;
  try {
    let opts = Object.defineProperty({}, 'passive', {
      get: function () {
        passive_param = { passive: false };
        return false;
      }
    });
    window.addEventListener('test', null, opts);
    window.removeEventListener('test', null, opts);
  } catch (e) {
    passive_param = false;
  }

  canvas.requestPointerLock = canvas.requestPointerLock || canvas.mozRequestPointerLock ||
    canvas.webkitRequestPointerLock;
  document.exitPointerLock = document.exitPointerLock || document.mozExitPointerLock ||
    document.webkitExitPointerLock || function () { /* nop */ };

  window.addEventListener('keydown', onKeyDown, false);
  window.addEventListener('keyup', onKeyUp, false);

  window.addEventListener('click', ignored, false);
  window.addEventListener('contextmenu', ignored, false);
  window.addEventListener('mousemove', onMouseMove, false);
  window.addEventListener('mousedown', onMouseDown, false);
  window.addEventListener('mouseup', onMouseUp, false);
  window.addEventListener('DOMMouseScroll', onWheel, false);
  window.addEventListener('mousewheel', onWheel, false);

  canvas.addEventListener('touchstart', onTouchChange, passive_param);
  canvas.addEventListener('touchmove', onTouchChange, passive_param);
  canvas.addEventListener('touchend', onTouchChange, passive_param);
  canvas.addEventListener('touchcancel', onTouchChange, passive_param);
}


const DEADZONE = 0.26;
const DEADZONE_SQ = DEADZONE * DEADZONE;
const NUM_STICKS = 2;
const PAD_THRESHOLD = 0.25; // for turning analog motion into digital events

function getGamepadData(idx) {
  let gpd = gamepad_data[idx];
  if (!gpd) {
    gpd = gamepad_data[idx] = {
      timestamp: 0,
      sticks: new Array(NUM_STICKS),
    };
    for (let ii = 0; ii < NUM_STICKS; ++ii) {
      gpd.sticks[ii] = vec2();
    }
    pad_states[idx] = {};
  }
  return gpd;
}

function updatePadState(ps, b, c) {
  if (b && !ps[c]) {
    ps[c] = DOWN_EDGE;
  } else if (!b && ps[c]) {
    ps[c] = UP_EDGE;
  }
}

function gamepadUpdate() {
  let gamepads = (navigator.gamepads ||
    navigator.webkitGamepads ||
    (navigator.getGamepads && navigator.getGamepads()) ||
    (navigator.webkitGetGamepads && navigator.webkitGetGamepads()));

  if (gamepads) {
    let numGamePads = gamepads.length;
    for (let ii = 0; ii < numGamePads; ii++) {
      let gamepad = gamepads[ii];
      if (!gamepad) {
        continue;
      }
      let gpd = getGamepadData(ii);
      let ps = pad_states[ii];
      // Update button states
      if (gpd.timestamp < gamepad.timestamp) {
        let buttons = gamepad.buttons;
        gpd.timestamp = gamepad.timestamp;

        let numButtons = buttons.length;
        for (let n = 0; n < numButtons; n++) {
          let value = buttons[n];
          if (typeof value === 'object') {
            value = value.value;
          }
          value = value > 0.5;
          updatePadState(ps, value, n);
        }
      }

      // Update axes states
      let axes = gamepad.axes;
      if (axes.length >= NUM_STICKS * 2) {
        for (let n = 0; n < NUM_STICKS; ++n) {
          let pair = gpd.sticks[n];
          v2set(pair, axes[n*2], -axes[n*2 + 1]);
          let magnitude = v2lengthSq(pair);
          if (magnitude > DEADZONE_SQ) {
            magnitude = sqrt(magnitude);

            // Normalize lX and lY
            v2scale(pair, pair, 1 / magnitude);

            // Clip the magnitude at its max possible value
            magnitude = min(magnitude, 1);

            // Adjust magnitude relative to the end of the dead zone
            magnitude = ((magnitude - DEADZONE) / (1 - DEADZONE));

            v2scale(pair, pair, magnitude);
          } else {
            v2set(pair, 0, 0);
          }
        }

        // Calculate virtual directional buttons
        updatePadState(ps, gpd.sticks[0][0] < -PAD_THRESHOLD, pad_codes.ANALOG_LEFT);
        updatePadState(ps, gpd.sticks[0][0] > PAD_THRESHOLD, pad_codes.ANALOG_RIGHT);
        updatePadState(ps, gpd.sticks[0][1] < -PAD_THRESHOLD, pad_codes.ANALOG_DOWN);
        updatePadState(ps, gpd.sticks[0][1] > PAD_THRESHOLD, pad_codes.ANALOG_UP);
      }
    }
  }
}

export function tick() {
  // browser frame has occurred since the call to endFrame(),
  // we should now have `touches` and `key_state` populated with edge events
  mouse_over_captured = false;
  gamepadUpdate();
  if (touches[pointerlock_touch_id] && !pointerLocked()) {
    pointerLockExit();
  }
}

function endFrameTickMap(map) {
  Object.keys(map).forEach((keycode) => {
    switch (map[keycode]) {
      case DOWN_EDGE:
        map[keycode] = DOWN;
        break;
      case UP_EDGE:
        delete map[keycode];
        break;
      default:
    }
  });
}
export function endFrame(skip_mouse) {
  endFrameTickMap(key_state);
  pad_states.forEach(endFrameTickMap);
  if (!skip_mouse) {
    for (let touch_id in touches) {
      let touch_data = touches[touch_id];
      if (touch_data.release) {
        delete touches[touch_id];
      } else {
        touch_data.delta[0] = touch_data.delta[1] = 0;
        touch_data.dispatched = false;
        if (touch_data.state === DOWN_EDGE) {
          touch_data.state = DOWN;
        } else {
          assert(touch_data.state !== UP_EDGE); // should also have set .release!
        }
      }
    }
    mouse_wheel = 0;
    input_eaten_mouse = false;
  }
  input_eaten_kb = false;
}

export function eatAllInput(skip_mouse) {
  // destroy touches, remove all down and up edges
  endFrame(skip_mouse);
  if (!skip_mouse) {
    mouse_over_captured = true;
    input_eaten_mouse = true;
  }
  input_eaten_kb = true;
}

export function eatAllKeyboardInput() {
  eatAllInput(true);
}

// returns position mapped to current camera view
export function mousePos(dst) {
  dst = dst || vec2();
  camera2d.physicalToVirtual(dst, mouse_pos);
  return dst;
}

export function mouseWheel() {
  let ret = mouse_wheel;
  mouse_wheel = 0;
  return ret;
}

function mousePosParam(param) {
  param = param || {};
  return {
    x: param.x === undefined ? camera2d.x0() : param.x,
    y: param.y === undefined ? camera2d.y0() : param.y,
    w: param.w === undefined ? camera2d.w() : param.w,
    h: param.h === undefined ? camera2d.h() : param.h,
    button: param.button === undefined ? ANY : param.button,
  };
}

let check_pos = vec2();
function checkPos(pos, param) {
  camera2d.physicalToVirtual(check_pos, pos);
  return check_pos[0] >= param.x && (param.w === Infinity || check_pos[0] < param.x + param.w) &&
    check_pos[1] >= param.y && (param.h === Infinity || check_pos[1] < param.y + param.h);
}

export function mouseOver(param) {
  if (mouse_over_captured) {
    return false;
  }
  let pos_param = mousePosParam(param);

  // eat mouse up/down events
  for (let id in touches) {
    let touch = touches[id];
    if (checkPos(touch.cur_pos, pos_param)) {
      if (touch.state === DOWN_EDGE) {
        touch.state = DOWN;
      } else if (touch.state === UP_EDGE) {
        touch.state = null;
      }
    }
  }

  if (checkPos(mouse_pos, pos_param)) {
    mouse_over_captured = true;
    return true;
  }
  return false;
}

export function mouseDown(button) {
  if (button === ANY) {
    return mouseDown(0) || mouseDown(2);
  }
  button = button || 0;
  return !input_eaten_mouse && mouse_down[button];
}

export function mousePosIsTouch() {
  return mouse_pos_is_touch;
}

export function isTouchDown(param) {
  if (input_eaten_mouse) {
    return false;
  }
  let pos_param = mousePosParam(param);
  for (let id in touches) {
    let touch = touches[id];
    if (checkPos(touch.cur_pos, pos_param)) {
      return check_pos.slice(0);
    }
  }
  return false;
}

export function numTouches() {
  return Object.keys(touches).length;
}

export function keyDown(keycode) {
  if (input_eaten_kb) {
    return false;
  }
  return Boolean(key_state[keycode]);
}
export function keyDownEdge(keycode) {
  if (key_state[keycode] === DOWN_EDGE) {
    key_state[keycode] = DOWN;
    return true;
  }
  return false;
}
export function keyUpEdge(keycode) {
  if (key_state[keycode] === UP_EDGE) {
    delete key_state[keycode];
    return true;
  }
  return false;
}

export function padGetAxes(out, stickindex, padindex) {
  assert(stickindex >= 0 && stickindex < NUM_STICKS);
  if (padindex === undefined) {
    let sub = vec2();
    v2set(out, 0, 0);
    for (let ii = 0; ii < gamepad_data.length; ++ii) {
      padGetAxes(sub, stickindex, ii);
      v2add(out, sub);
    }
    return;
  }
  let sticks = getGamepadData(padindex).sticks;
  v2copy(out, sticks[stickindex]);
}

function padButtonDownInternal(ps, padcode) {
  return Boolean(ps[padcode]);
}
function padButtonDownEdgeInternal(ps, padcode) {
  if (ps[padcode] === DOWN_EDGE) {
    ps[padcode] = DOWN;
    return true;
  }
  return false;
}
function padButtonUpEdgeInternal(ps, padcode) {
  if (ps[padcode] === UP_EDGE) {
    delete ps[padcode];
    return true;
  }
  return false;
}

const ANALOG_MAP = (function () {
  if (!MAP_ANALOG_TO_DPAD) {
    return {};
  }
  let r = {};
  r[pad_codes.LEFT] = pad_codes.ANALOG_LEFT;
  r[pad_codes.RIGHT] = pad_codes.ANALOG_RIGHT;
  r[pad_codes.UP] = pad_codes.ANALOG_UP;
  r[pad_codes.DOWN] = pad_codes.ANALOG_DOWN;
  return r;
}());
function padButtonShared(fn, padcode, padindex) {
  assert(padcode !== undefined);
  // Handle calling without a specific pad index
  if (padindex === undefined) {
    for (let ii = 0; ii < pad_states.length; ++ii) {
      if (padButtonShared(fn, padcode, ii)) {
        return true;
      }
    }
    return false;
  }

  if (input_eaten_mouse) {
    return false;
  }
  let ps = pad_states[padindex];
  if (!ps) {
    return false;
  }

  if (ANALOG_MAP[padcode] && fn(ps, ANALOG_MAP[padcode])) {
    return true;
  }
  return fn(ps, padcode);
}
export function padButtonDown(padcode, padindex) {
  return padButtonShared(padButtonDownInternal, padcode, padindex);
}
export function padButtonDownEdge(padcode, padindex) {
  return padButtonShared(padButtonDownEdgeInternal, padcode, padindex);
}
export function padButtonUpEdge(padcode, padindex) {
  return padButtonShared(padButtonUpEdgeInternal, padcode, padindex);
}

let start_pos = vec2();
let cur_pos = vec2();
let delta = vec2();

export function mouseUpEdge(param) {
  param = param || {};
  let pos_param = mousePosParam(param);
  let button = pos_param.button;
  let max_click_dist = param.max_dist || 50; // TODO: relative to camera distance?

  for (let touch_id in touches) {
    let touch_data = touches[touch_id];
    if (touch_data.state !== UP_EDGE ||
      !(button === ANY || button === touch_data.button) ||
      touch_data.total > max_click_dist
    ) {
      continue;
    }
    if (checkPos(touch_data.cur_pos, pos_param)) {
      touch_data.state = null;
      return {
        button: touch_data.button,
        pos: check_pos.slice(0),
        start_time: touch_data.start_time,
      };
    }
  }
  return false;
}
exports.click = mouseUpEdge;

export function mouseDownEdge(param) {
  param = param || {};
  let pos_param = mousePosParam(param);
  let button = pos_param.button;

  for (let touch_id in touches) {
    let touch_data = touches[touch_id];
    if (touch_data.state !== DOWN_EDGE ||
      !(button === ANY || button === touch_data.button)
    ) {
      continue;
    }
    if (checkPos(touch_data.cur_pos, pos_param)) {
      touch_data.state = DOWN;
      return {
        button: touch_data.button,
        pos: check_pos.slice(0),
        start_time: touch_data.start_time,
      };
    }
  }
  return false;
}

export function drag(param) {
  param = param || {};
  let pos_param = mousePosParam(param);
  let button = pos_param.button;

  for (let touch_id in touches) {
    let touch_data = touches[touch_id];
    if (!(button === ANY || button === touch_data.button) || touch_data.dispatched) {
      continue;
    }
    if (checkPos(touch_data.start_pos, pos_param)) {
      if (!param.peek) {
        touch_data.dispatched = true;
      }
      camera2d.physicalToVirtual(start_pos, touch_data.start_pos);
      camera2d.physicalToVirtual(cur_pos, touch_data.cur_pos);
      camera2d.physicalDeltaToVirtual(delta, [touch_data.total/2, touch_data.total/2]);
      let total = delta[0] + delta[1];
      camera2d.physicalDeltaToVirtual(delta, touch_data.delta);
      return {
        cur_pos,
        start_pos,
        delta, // this frame's delta
        total, // total (linear) distance dragged
        button: touch_data.button,
        touch: touch_data.touch,
        start_time: touch_data.start_time,
      };
    }
  }
  return null;
}
