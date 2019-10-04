// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const assert = require('assert');
const regex_ipv4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u;
export function ipFromRequest(req) {
  // See getRemoteAddressFromRequest() for more implementation details, possibilities, proxying options
  // console.log('Client connection headers ' + JSON.stringify(req.headers));

  // Security note: must check x-forwarded-for *only* if we know this request came from a
  //   reverse proxy, should warn if missing x-forwarded-for.
  let ip = req.headers['x-forwarded-for'] || req.client.remoteAddress ||
    req.client.socket && req.client.socket.remoteAddress;
  // let port = req.headers['x-forwarded-port'] || req.client.remotePort ||
  //   req.client.socket && req.client.socket.remotePort;
  assert(ip);
  let m = ip.match(regex_ipv4);
  if (m) {
    ip = m[1];
  }
  return ip;
  // return `${ip}${port ? `:${port}` : ''}`;
}

export function allowMapFromLocalhostOnly(app) {
  let debug_ips = /^(?:::1)|(?:127\.0\.0\.1)(?::\d+)?$/u;
  let cache = {};
  app.use(function (req, res, next) {
    let ip = ipFromRequest(req);
    let cached = cache[ip];
    if (cached === undefined) {
      cache[ip] = cached = Boolean(ip.match(debug_ips));
      if (cached) {
        console.info(`Allowing dev access from ${ip}`);
      } else {
        console.warn(`NOT Allowing dev access from ${ip}`);
      }
    }
    req.glov_is_dev = cached;
    next();
  });
  app.all('*.map', function (req, res, next) {
    if (req.glov_is_dev) {
      return next();
    }
    return next(`Cannot ${req.method} ${req.url}`);
  });
}
