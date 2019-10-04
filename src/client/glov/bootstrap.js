// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

// Things that should be done before requiring or running any user-level code or other engine code

(function () {
  let debug = document.getElementById('debug');
  window.onerror = function (e, file, line, col, errorobj) {
    let msg = errorobj && errorobj.stack || `${e}\n  at ${file}(${line}:${col})`;
    debug.innerText = `${msg}\n\nPlease report this error to the developer, and then reload this page.`;
    if (window.glov_error_report) {
      window.glov_error_report(msg, file, line, col);
    }
  };
  window.debugmsg = function (msg, clear) {
    if (clear) {
      debug.innerText = msg;
    } else {
      debug.innerText += `${msg}\n`;
    }
  };
}());
