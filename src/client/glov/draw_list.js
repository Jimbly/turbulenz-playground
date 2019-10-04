// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const engine = require('./engine.js');
const { mat_vp } = engine;

let list = [];

// obj must have .mat and .drawAlpha() and optionally .sort_bias
export function alphaQueue(obj) {
  //let transformed_pos = vec4();
  //vec4.transformMat4(transformed_pos, obj.mat.slice(12), mat_vp);
  //let sort_z = transformed_pos[2];

  let sort_z = mat_vp[2] * obj.mat[12] +
    mat_vp[6] * obj.mat[13] +
    mat_vp[10] * obj.mat[14] +
    mat_vp[14]; // * obj.mat[15]; should be 1?

  list.push([sort_z + (obj.sort_bias || 0), obj]);
}

function cmpAlpha(a, b) {
  return b[0] - a[0];
}

export function alphaDraw() {
  gl.enable(gl.BLEND);
  gl.depthMask(false);

  list.sort(cmpAlpha);
  for (let ii = 0; ii < list.length; ++ii) {
    list[ii][1].drawAlpha();
  }
  list = [];
}
