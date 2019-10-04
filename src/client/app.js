/* eslint global-require:off */

// Startup code.

window.onload = function () {
  require('./glov/bootstrap.js');
  require('./main.js').main();
};
