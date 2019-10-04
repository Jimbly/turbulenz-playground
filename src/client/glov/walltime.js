
let offs = 0;
function now() {
  return Date.now() + offs;
}
module.exports = exports = now;
exports.now = now;
exports.sync = function (server_time) {
  offs = server_time - Date.now();
};
