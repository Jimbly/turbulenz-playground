// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
/* eslint no-alert:off, consistent-return:off */
(function () {
  let debug = document.getElementById('debug');
  window.onerror = function (e, file, line) {
    debug.innerText = `${e}\n  at ${file}(${line})`;
  };
  window.debugmsg = function (msg, clear) {
    if (clear) {
      debug.innerText = msg;
    } else {
      debug.innerText += `${msg}\n`;
    }
  };
}());

// Embedded code and startup code.
window.onload = function () {
  // eslint-disable-next-line global-require
  const main = require('./main.js');

  let canvas = document.getElementById('canvas');

  function resizeCanvas() {
    let css_to_real = window.devicePixelRatio || 1;
    window.pixel_scale = css_to_real;
    canvas.width = Math.round(canvas.clientWidth * css_to_real);
    canvas.height = Math.round(canvas.clientHeight * css_to_real);
  }
  // resize the canvas to fill browser window dynamically
  window.addEventListener('resize', resizeCanvas, false);
  resizeCanvas();

  let contextNames = ['webgl', 'experimental-webgl'];
  for (let i = 0; i < contextNames.length; i += 1) {
    try {
      window.gl = canvas.getContext(contextNames[i]);
    } catch (e) {
      // ignore
    }
    if (window.gl) {
      return main.main(canvas);
    }
  }
  window.alert('Sorry, but your browser does not support WebGL or does not have it enabled.');
  document.getElementById('loading').style.visibility = 'hidden';
};
