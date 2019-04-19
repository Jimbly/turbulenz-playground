// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
/* eslint no-shadow:off */

const engine = require('./engine.js');

const { round } = Math;

export const data = new Float32Array(9); // x0, y0, x1, y1, x_scale, y_scale, css_to_real

let screen_width;
let screen_height;
// Note: render_* not used by FRVR at this time
let render_width;
let render_height;
export let render_viewport_w;
export let render_viewport_h;
export let render_offset_x;
export let render_offset_y;

function reapply() {
  if (render_width) {
    data[4] = render_width / (data[2] - data[0]);
    data[5] = render_height / (data[3] - data[1]);
    data[7] = (data[2] - data[0]) / render_viewport_w;
    data[8] = (data[3] - data[1]) / render_viewport_h;
  } else {
    data[4] = screen_width / (data[2] - data[0]);
    data[5] = screen_height / (data[3] - data[1]);
  }
}

// To get to coordinates used by OpenGL / canvas
export function virtualToCanvas(dst, src) {
  dst[0] = (src[0] - data[0]) * data[4];
  dst[1] = (src[1] - data[1]) * data[5];
}

// Sets the 2D "camera" used to translate sprite positions to screen space.  Affects sprites queued
//  after this call
export function set(x0, y0, x1, y1) {
  data[0] = x0;
  data[1] = y0;
  data[2] = x1;
  data[3] = y1;
  reapply();
}

// Drawing area 0,0-w,h
// But keep the aspect ratio of those things drawn to be correct
// This may create a padding or margin on either top and bottom or sides of the screen
// User users constant values in this range for consistent UI on all devices
export function setAspectFixed(w, h) {
  let pa = engine.render_width ? 1 : engine.pixel_aspect;
  let inv_aspect = h / pa / w;
  let inv_desired_aspect;
  if (render_width) {
    inv_desired_aspect = render_height / render_width;
  } else {
    inv_desired_aspect = screen_height / screen_width;
  }
  if (inv_aspect > inv_desired_aspect) {
    let margin = (h / pa / inv_desired_aspect - w) / 2;
    set(-margin, 0, w + margin, h);
  } else {
    let margin = (w * pa * inv_desired_aspect - h) / 2;
    set(0, -margin, w, h + margin);
  }
}

// Primary drawing area at least W x H
// But keep the aspect ratio of those things drawn to be correct
// Similar to setAspectFixed() but keeps (0,0) in the upper left (all padding
//   is added to right and bottom)
// Requires users to use camera2d.w()/ and camera2d.h() to determine reasonable
//   UI positioning
export function setAspectFixed2(w, h) {
  let pa = engine.render_width ? 1 : engine.pixel_aspect;
  let inv_aspect = h / pa / w;
  let inv_desired_aspect;
  if (render_width) {
    inv_desired_aspect = render_height / render_width;
  } else {
    inv_desired_aspect = screen_height / screen_width;
  }
  if (inv_aspect > inv_desired_aspect) {
    let margin = (h / pa / inv_desired_aspect - w);
    set(0, 0, w + margin, h);
  } else {
    let margin = (w * pa * inv_desired_aspect - h);
    set(0, 0, w, h + margin);
  }
}

export function zoom(x, y, factor) {
  let inv_factor = 1.0 / factor;
  set(
    x - (x - data[0]) * inv_factor,
    y - (y - data[1]) * inv_factor,
    x + (data[2] - x) * inv_factor,
    y + (data[3] - y) * inv_factor);
}

export function setNormalized() {
  set(0, 0, 1, 1);
}

export function x0() {
  return data[0];
}
export function y0() {
  return data[1];
}
export function x1() {
  return data[2];
}
export function y1() {
  return data[3];
}
export function w() {
  return data[2] - data[0];
}
export function h() {
  return data[3] - data[1];
}
export function xScale() {
  return data[4];
}
export function yScale() {
  return data[5];
}

export function htmlPos(x, y) {
  if (render_width) {
    return [
      100 * (((x - data[0]) / data[7] + render_offset_x) / screen_width),
      100 * (((y - data[1]) / data[8] + render_offset_y) / screen_height),
    ];
  } else {
    return [
      100 * (x - data[0]) / (data[2] - data[0]),
      100 * (y - data[1]) / (data[3] - data[1]),
    ];
  }
}
export function htmlSize(w, h) {
  if (render_width) {
    return [
      100 * w / data[7] / screen_width,
      100 * h / data[8] / screen_height,
    ];
  } else {
    return [100 * w / (data[2] - data[0]), 100 * h / (data[3] - data[1])];
  }
}

export function physicalToVirtual(dst, src) {
  if (render_width) {
    dst[0] = (src[0] * data[6] - render_offset_x) * data[7] + data[0];
    dst[1] = (src[1] * data[6] - render_offset_y) * data[8] + data[1];
  } else {
    dst[0] = src[0] * data[6] / data[4] + data[0];
    dst[1] = src[1] * data[6] / data[5] + data[1];
  }
}

export function physicalDeltaToVirtual(dst, src) {
  if (render_width) {
    dst[0] = src[0] * data[6] * data[7];
    dst[1] = src[1] * data[6] * data[8];
  } else {
    dst[0] = src[0] * data[6] / data[4];
    dst[1] = src[1] * data[6] / data[5];
  }
}

// To get to coordinates used by mouse events
export function virtualToPhysical(dst, src) {
  if (render_width) {
    dst[0] = (render_offset_x + (src[0] - data[0]) / data[7]) / data[6];
    dst[1] = (render_offset_y + (src[1] - data[1]) / data[8]) / data[6];
  } else {
    dst[0] = (src[0] - data[0]) * data[4] / data[6];
    dst[1] = (src[1] - data[1]) * data[5] / data[6];
  }
}

export function tick() {
  data[6] = window.devicePixelRatio || 1; /* css_to_real */
  screen_width = engine.width;
  screen_height = engine.height;
  let viewport = [0, 0, screen_width, screen_height];
  if (engine.render_width) { // Note: render_* not used by FRVR at this time
    render_width = engine.render_width;
    render_height = engine.render_height;
    // Find an offset so this rendered viewport is centered while preserving aspect ratio, just like setAspectFixed
    let pa = engine.pixel_aspect;
    let inv_aspect = render_height / pa / render_width;
    let inv_desired_aspect = screen_height / screen_width;
    if (inv_aspect > inv_desired_aspect) {
      let margin = (render_height / inv_desired_aspect - render_width * pa) / 2 *
        screen_height / render_height;
      render_offset_x = round(margin);
      render_offset_y = 0;
      render_viewport_w = round(screen_width - margin * 2);
      render_viewport_h = screen_height;
    } else {
      let margin = (render_width * inv_desired_aspect - render_height / pa) / 2 *
        screen_width / render_width;
      render_offset_x = 0;
      render_offset_y = round(margin);
      render_viewport_w = screen_width;
      render_viewport_h = round(screen_height - margin * 2);
    }
    viewport[2] = render_width;
    viewport[3] = render_height;
  } else {
    render_width = render_height = 0;
    render_offset_x = 0;
    render_offset_y = 0;
  }

  reapply();

  // let screen_width = engine.width;
  // let screen_height = engine.height;
  // let screen_aspect = screen_width / screen_height;
  // let view_aspect = game_width / game_height;
  // if (screen_aspect > view_aspect) {
  //   let viewport_width = game_height * screen_aspect;
  //   let half_diff = (viewport_width - game_width) / 2;
  //   viewportRectangle = [-half_diff, 0, game_width + half_diff, game_height];
  // } else {
  //   let viewport_height = game_width / screen_aspect;
  //   let half_diff = (viewport_height - game_height) / 2;
  //   viewportRectangle = [0, -half_diff, game_width, game_height + half_diff];
  // }

  engine.setViewport(viewport);
}

export function startup() {
  set(0, 0, engine.width, engine.height);
  tick();
}
