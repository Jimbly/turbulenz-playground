// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
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
  require('./main.js').main();
};
