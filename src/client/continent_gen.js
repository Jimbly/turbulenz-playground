/*eslint no-labels:off */
const assert = require('assert');
const { abs, atan2, ceil, cos, max, min, floor, round, pow, sin, sqrt, PI } = Math;
const { C_WATER, C_PLAINS, C_HILLS, C_MOUNTAINS, SKEW_X } = require('./proc_gen_constants.js');
const { randCreate } = require('./glov/rand_alea.js');
const SimplexNoise = require('simplex-noise');
const { clamp, lerp, ridx } = require('../common/util.js');
const {
  vec2, v2copy, v2lengthSq,
} = require('./glov/vmath.js');

const default_tex_size = 256;

const TWOPI = PI * 2;

// For `fill` buffer
export const D_OPEN = 0;
export const D_BORDER = 1;
export const D_SEA = 2;
export const D_SEA2 = 3;
export const D_INLAND_SEA = 4;
export const D_COASTLINE = 5;
export const D_LAKE = 6;

export const default_opts = {
  hex_tex_size: default_tex_size,
  seed: 1,
  coast: {
    key: '',
    frequency: 2,
    amplitude: 1,
    persistence: 0.5,
    lacunarity: { min: 1.6, max: 2.8, freq: 0.3 },
    octaves: 6,
    cutoff: 0.5,
    domain_warp: 0,
    warp_freq: 1,
    warp_amp: 0.1,
    fill_seas: true,
    channels: true,
  },
  tslope: {
    key: 'ts',
    frequency: 3.5,
    amplitude: 1,
    min: 0,
    range: 8,
    persistence: 0.5,
    lacunarity: 1.33,
    octaves: 1,
    domain_warp: 1,
    warp_freq: 1,
    warp_amp: 0.1,
  },
  rslope: {
    key: 'rs',
    frequency: 1.2,
    amplitude: 1,
    persistence: 0.5,
    lacunarity: 1.33,
    octaves: 1,
    domain_warp: 1,
    warp_freq: 1,
    warp_amp: 0.1,
    steps: 4,
  },
  river: {
    weight_bend: 2,
    weight_afork: 2,
    weight_sfork: 1,
    max_tslope: 48,
    tuning_h: 32,
    show_elev: true, // debug display option, not used by generator
    prune: true,
    mtify_prune_grace: 100,
    mtify_prune: true,
  },
  ocean: {
    frequency: 3,
    amplitude: 1,
    persistence: 0.5,
    lacunarity: 2.4,
    octaves: 3,
    domain_warp: 1,
    warp_freq: 1,
    warp_amp: 1,
  },
  lakes: {
    lake_search_radius: round(10 * default_tex_size/256),
    lake_percent: 0.10,
    lake_k: 5,
    min_sep: round(40 * default_tex_size/256),
  },
  blur: {
    threshold: 500,
    weight: 1,
  },
  mountainify: {
    peak_radius: round(10 * default_tex_size/256),
    peak_percent: 0.80,
    peak_k: 5,
    height_scale: 3,
    blend_radius: round(10 * default_tex_size/256),
    weight_local: 0.25,
    power_min: 1,
    power_max: 4,
    power_blend: 0.25,
    cdist_ramp: 2,
  },
  humidity: {
    frequency: 2.2,
    amplitude: 1,
    persistence: 0.5,
    lacunarity: 4,
    octaves: 3,
    domain_warp: 0,
    warp_freq: 1,
    warp_amp: 1,
    rainshadow: 0.75,
    show_relief: false, // debug display option, makes extreme rainshadow
  },
  classif: {
    cut1: 0.033,
    cut2: 0.666,
    blur_scale: 680,
    blur_w: 10,
    show_rivers: false, // debug display option, not used by generator
  },
  output: {
    sea_range_exp: 13,
    land_range_exp: 14,
    sea_range: 1 << 13,
    land_range: 1 << 14,
    debug: false,
  },
  early_out: null, // 'river'
};

let land;
let fill;
let util;
let mountain_delta;
let tslope;
let rslope;
let river;
let relev;
let rstrahler;
let water_level;
let coast_distance;
let ocean_distance;
let humidity;
let classif;
let blur_temp1;
let blur_temp2;
let debug_priority;

let total_size;
let width;
let height;
let neighbors_bit;
let state;

function setupWorkBuffers(hex_tex_size) {
  total_size = hex_tex_size * hex_tex_size;
  width = height = hex_tex_size;

  land = new Uint8Array(total_size);
  fill = new Uint8Array(total_size);
  util = new Uint8Array(total_size);
  mountain_delta = new Uint32Array(total_size);
  tslope = new Uint8Array(total_size);
  rslope = new Uint8Array(total_size);
  river = new Uint8Array(total_size);
  relev = new Uint16Array(total_size);
  rstrahler = new Uint8Array(total_size);
  water_level = new Uint16Array(total_size);
  coast_distance = new Uint8Array(total_size);
  ocean_distance = new Uint8Array(total_size);
  humidity = new Uint8Array(total_size);
  classif = new Uint8Array(total_size);
  blur_temp1 = new Uint32Array(total_size);
  blur_temp2 = new Uint32Array(total_size);

  let neighbors_even = [
    width, // above
    1, // upper right
    1 - width, // lower right
    -width, // below
    -1 - width, // lower left
    -1, // upper left
  ];
  let neighbors_odd = [
    width, // above
    1 + width, // upper right,
    1, // lower right
    -width, // below
    -1, // lower left
    -1 + width, // upper left,
  ];
  neighbors_bit = [neighbors_even, neighbors_odd];
}

let last_tex_size = -1;
let unif_pos = vec2();
let world_pos = vec2();
let opts;
let subopts;

let rand;
function shuffleArray(arr) {
  for (let ii = arr.length - 1; ii >= 1; --ii) {
    let swap = rand.range(ii + 1);
    let t = arr[ii];
    arr[ii] = arr[swap];
    arr[swap] = t;
  }
}

let noise;
let noise_warp;
let total_amplitude;
let noise_field;
function initNoise(subopts_in) {
  subopts = subopts_in;
  noise = new Array(subopts.octaves);
  for (let ii = 0; ii < noise.length; ++ii) {
    noise[ii] = new SimplexNoise(`${opts.seed}n${subopts.key}${ii}`);
  }
  noise_warp = new Array(subopts.domain_warp);
  for (let ii = 0; ii < noise_warp.length; ++ii) {
    noise_warp[ii] = new SimplexNoise(`${opts.seed}w${subopts.key}${ii}`);
  }
  total_amplitude = 0;  // Used for normalizing result to 0.0 - 1.0
  let amp = subopts.amplitude;
  let p = subopts.persistence && subopts.persistence.max || subopts.persistence;
  for (let ii=0; ii<subopts.octaves; ii++) {
    total_amplitude += amp;
    amp *= p;
  }
  noise_field = {};
  for (let f in subopts) {
    let v = subopts[f];
    if (typeof v === 'object') {
      noise_field[f] = new SimplexNoise(`${opts.seed}f${subopts.key}${f}`);
      v.mul = (v.max - v.min) * 0.5;
      v.add = v.min + v.mul;
    }
  }
}

let sample_pos = vec2();
function get(field) {
  let v = subopts[field];
  if (typeof v !== 'object') {
    return v;
  }
  return v.add + v.mul * noise_field[field].noise2D(sample_pos[0] * v.freq, sample_pos[1] * v.freq);
}
function sample() {
  v2copy(sample_pos, unif_pos);
  let warp_freq = subopts.warp_freq;
  let warp_amp = subopts.warp_amp;
  for (let ii = 0; ii < subopts.domain_warp; ++ii) {
    let dx = noise_warp[ii].noise2D(sample_pos[0] * warp_freq, sample_pos[1] * warp_freq);
    let dy = noise_warp[ii].noise2D((sample_pos[0] + 7) * warp_freq, sample_pos[1] * warp_freq);
    sample_pos[0] += dx * warp_amp;
    sample_pos[1] += dy * warp_amp;
  }
  let total = 0;
  let amp = subopts.amplitude;
  let freq = get('frequency');
  let p = get('persistence');
  let lac = get('lacunarity');
  for (let i=0; i<subopts.octaves; i++) {
    total += (0.5 + 0.5 * noise[i].noise2D(sample_pos[0] * freq, sample_pos[1] * freq)) * amp;
    amp *= p;
    freq *= lac;
  }
  return total/total_amplitude;
}

const HEX_HEIGHT = 1.0; // distance between any two hexes = 1.0
const HEX_EDGE = HEX_HEIGHT / sqrt(3);
const HEX_WIDTH = 1.5 * HEX_EDGE;
function hexPosToUnifPos(ii, jj) {
  world_pos[0] = ii * HEX_WIDTH;
  world_pos[1] = jj * HEX_HEIGHT - HEX_HEIGHT * 0.5;
  if (ii & 1) {
    world_pos[1] += HEX_HEIGHT * 0.5;
  }
  unif_pos[0] = world_pos[0] / ((width - 1) * HEX_WIDTH) * 2.0 - 1.0;
  unif_pos[1] = world_pos[1] / ((height - 1.5) * HEX_HEIGHT) * 2.0 - 1.0;
}

let count_by_h;
function generateCoastlines() {
  initNoise(opts.coast);

  if (!count_by_h) {
    count_by_h = new Array(256);
  }
  for (let ii = 0; ii < 256; ++ii) {
    count_by_h[ii] = 0;
  }
  for (let idx=0, jj = 0; jj < height; ++jj) {
    for (let ii = 0; ii < width; ++ii, ++idx) {
      hexPosToUnifPos(ii, jj);

      let h = sample();
      //let cutoff_scale = cutoff / 255; // scale cutoff to extend nearer to edge of maps
      //h *= cutoff_scale + (1 - cutoff_scale) * (1 - v2lengthSq(unif_pos));
      h *= 1 - v2lengthSq(unif_pos);

      h = clamp(floor(h * 255), 0.0, 255);
      count_by_h[h]++;
      land[idx] = h;
    }
  }
  // Determine cutoff as a percentile
  //   Probably not generally necessary, but allows for playing with domain-warped
  //   persistence sliders without changing the overall density, etc.
  let cutoff_percent = get('cutoff');
  cutoff_percent = 1 - (1 - cutoff_percent) * (1 - cutoff_percent);
  let cutoff_count = total_size * cutoff_percent;
  let cutoff = 0;
  for (cutoff = 0; cutoff_count > 0 && cutoff < 256; ++cutoff) {
    cutoff_count -= count_by_h[cutoff];
  }
  for (let ii = 0; ii < total_size; ++ii) {
    let h = land[ii];
    land[ii] = h > cutoff ? 255 : 0;
    fill[ii] = D_OPEN;
  }
}

function fillSeas() {
  let unfilled_seas = state.unfilled_seas = [];
  let todo = [];
  let done = [];
  function fillBorders() {
    for (let ii = 0; ii < width; ++ii) {
      fill[ii] = D_BORDER;
      fill[(height - 1) * width + ii] = D_BORDER;
    }
    for (let ii = 0; ii < height; ++ii) {
      fill[width * ii] = D_BORDER;
      fill[width * ii + width - 1] = D_BORDER;
    }
  }
  fillBorders();
  function tryMark(pos, v) {
    if (land[pos] || fill[pos]) {
      return;
    }
    fill[pos] = v;
    todo.push(pos);
    done.push(pos);
  }
  function spreadSeas(v) {
    while (todo.length) {
      let pos = todo.pop();
      let neighbors = neighbors_bit[pos & 1];
      for (let ii = 0; ii < neighbors.length; ++ii) {
        tryMark(pos + neighbors[ii], v);
      }
    }
  }
  tryMark(width + 1, D_SEA);
  spreadSeas(D_SEA);
  // Find all inland seas, mark them, then grow them N steps to either find a channel or fill them
  let inland_seas = [];
  for (let pos = 0; pos < width * height; ++pos) {
    if (!land[pos] && !fill[pos]) {
      // open, and not an ocean or previously marked
      done = [];
      tryMark(pos, D_INLAND_SEA);
      spreadSeas(D_INLAND_SEA);
      inland_seas.push(done);
    }
  }
  shuffleArray(inland_seas);
  inland_seas.forEach(function (sea) {
    // Channel to ocean if possible
    let is_ocean = false;
    if (subopts.channels) {
      let checked = [];
      for (let ii = 0; ii < sea.length; ++ii) {
        checked[sea[ii]] = 1;
      }
      let adjacent = [];
      for (let ii = 0; ii < sea.length; ++ii) {
        let pos = sea[ii];
        let neighbors = neighbors_bit[pos & 1];
        for (let nidx = 0; nidx < neighbors.length; ++nidx) {
          let npos = pos + neighbors[nidx];
          if (!checked[npos]) {
            adjacent.push(npos);
            // if (!data[npos * BPP]) {
            //   // a neighboring sea already channeled this, it must connect to the ocean!
            // }
            checked[npos] = 1;
          }
        }
      }
      shuffleArray(adjacent);
      outer:
      for (let ii = 0; ii < adjacent.length; ++ii) {
        let pos = adjacent[ii];
        let neighbors = neighbors_bit[pos & 1];
        for (let nidx = 0; nidx < neighbors.length; ++nidx) {
          let npos = pos + neighbors[nidx];
          if (!checked[npos] && !land[npos] && fill[npos] === D_SEA) {
            // open route to the ocean!
            land[pos] = 0;
            sea.push(pos);
            land[npos] = 0;
            sea.push(npos);
            for (let jj = 0; jj < sea.length; ++jj) {
              fill[sea[jj]] = D_SEA;
            }
            is_ocean = true;
            break outer;
          }
        }
      }
    }
    if (!is_ocean) {
      if (subopts.fill_seas) {
        for (let ii = 0; ii < sea.length; ++ii) {
          land[sea[ii]] = 255;
          fill[sea[ii]] = D_OPEN;
        }
      } else {
        unfilled_seas.push(sea);
      }
    }
  });
}

// Generates poisson sampled points with between radius and 2 * radius between each
function poissonSample(radius, k) {
  let ret = [];
  let peak_rsquared = radius * radius;
  let cell_bound = radius / sqrt(2);
  let cell_w = ceil(width / cell_bound);
  let cell_h = ceil(height / cell_bound);
  let cells = new Int16Array(cell_w * cell_h);
  let active = [];
  function emitSample(pos) {
    let posx = pos % width;
    let posy = (pos - posx) / width;
    let cellidx = ((posx / cell_bound)|0) + ((posy / cell_bound)|0) * cell_w;
    ret.push(pos);
    cells[cellidx] = ret.length;
    active.push(pos);
  }
  emitSample(rand.range(total_size));

  // From https://www.jasondavies.com/poisson-disc/
  // Generate point chosen uniformly from spherical annulus between radius r and 2r from p.
  let nx;
  let ny;
  function generateAround(px, py) {
    let θ = rand.random() * 2 * PI;
    let r = sqrt(rand.random() * 3 * peak_rsquared + peak_rsquared); // http://stackoverflow.com/a/9048443/64009
    nx = (px + r * cos(θ)) | 0;
    ny = (py + r * sin(θ)) | 0;
  }

  function near() {
    let n = 2;
    let x = nx / cell_bound | 0;
    let y = ny / cell_bound | 0;
    let x0 = max(x - n, 0);
    let y0 = max(y - n, 0);
    let x1 = min(x + n + 1, cell_w);
    let y1 = min(y + n + 1, cell_h);
    for (let yy = y0; yy < y1; ++yy) {
      let o = yy * cell_w;
      for (let xx = x0; xx < x1; ++xx) {
        let g = cells[o + xx];
        if (!g) {
          continue;
        }
        g = ret[g - 1];
        let gx = g % width;
        let gy = (g - gx) / width;
        let dsq = (nx - gx) * (nx - gx) + (ny - gy) * (ny - gy);
        if (dsq < peak_rsquared) {
          return true;
        }
      }
    }
    return false;
  }

  while (active.length) {
    let active_idx = rand.range(active.length);
    let pos = active[active_idx];
    ridx(active, active_idx);
    let posx = pos % width;
    let posy = (pos - posx) / width;
    for (let jj = 0; jj < k; ++jj) {
      generateAround(posx, posy);
      if (nx < 0 || nx >= width || ny < 0 || ny >= height || near()) {
        continue;
      }
      emitSample(nx + ny * width);
    }
  }
  return ret;
}

function findMaxPerRegion(candidates, map, radius) {
  let ret = [];
  for (let ii = 0; ii < candidates.length; ++ii) {
    let pos = candidates[ii];
    let posx = pos % width;
    let posy = (pos - posx) / width;
    let x0 = max(0, posx - radius);
    let x1 = min(width - 1, posx + radius);
    let y0 = max(0, posy - radius);
    let y1 = min(height - 1, posy + radius);
    let max_elev = map[pos];
    let max_pos = pos;
    for (let yy = y0; yy <= y1; ++yy) {
      for (let xx = x0; xx <= x1; ++xx) {
        let p = xx + yy * width;
        let e = map[p];
        if (e > max_elev) {
          max_elev = e;
          max_pos = p;
        }
      }
    }
    ret.push([max_elev, max_pos]);
  }
  ret.sort((a,b) => b[0] - a[0]);
  return ret;
}

function generateLakes() {
  subopts = opts.lakes;
  let lakes = state.lakes = [];
  let lake_seeds = state.lake_seeds = [];
  function generateInlandDF() {
    util.fill(0);
    let todo = [];
    let d = 0;
    for (let pos = 0; pos < total_size; ++pos) {
      if (!land[pos]) {
        util[pos] = 1;
        coast_distance[pos] = 0;
        continue;
      }
      let neighbors = neighbors_bit[pos & 1];
      for (let ii = 0; ii < neighbors.length; ++ii) {
        let nidx = pos + neighbors[ii];
        if (!land[nidx]) {
          todo.push(pos);
          coast_distance[pos] = d;
          util[pos] = 1;
          break;
        }
      }
    }
    while (todo.length) {
      d = min(d + 1, 255);
      let next = [];
      for (let ii = 0; ii < todo.length; ++ii) {
        let pos = todo[ii];
        let neighbors = neighbors_bit[pos & 1];
        for (let jj = 0; jj < neighbors.length; ++jj) {
          let npos = pos + neighbors[jj];
          if (!util[npos]) {
            util[npos] = 1;
            coast_distance[npos] = d;
            if (fill[npos] !== D_BORDER) {
              next.push(npos);
            }
          }
        }
      }
      todo = next;
    }
  }
  generateInlandDF();

  let { lake_search_radius, lake_k, lake_percent, min_sep } = subopts;
  let check_points = poissonSample(lake_search_radius, lake_k);
  let lake_elev = findMaxPerRegion(check_points, coast_distance, floor(lake_search_radius / 2));
  lake_elev = lake_elev.filter((a) => a[0] > 2);
  let want = floor(lake_elev.length * lake_percent);
  let use = [];
  let min_sep_sq = min_sep * min_sep;
  for (let ii = 0; ii < lake_elev.length && use.length < want; ++ii) {
    let pt = lake_elev[ii][1];
    let px = pt % width;
    let py = (pt - px) / width;
    let too_close = false;
    for (let jj = 0; jj < use.length; ++jj) {
      let other = use[jj];
      let dx = px - other[0];
      let dy = py - other[1];
      let dsq = dx*dx + dy*dy;
      if (dsq < min_sep_sq) {
        too_close = true;
        break;
      }
    }
    if (too_close) {
      continue;
    }
    use.push([px, py]);
  }

  function placeLake(x, y) {
    let pos = x + y * width;
    fill[pos] = D_INLAND_SEA;
    land[pos] = 0;
    lake_seeds.push(pos);
    lakes.push(pos);
  }
  for (let ii = 0; ii < use.length; ++ii) {
    placeLake(use[ii][0], use[ii][1]);
  }
}

function generateTerrainSlope() {
  initNoise(opts.tslope);
  for (let jj = 0; jj < height; ++jj) {
    for (let ii = 0; ii < width; ++ii) {
      hexPosToUnifPos(ii, jj);

      let h = sample();
      let min_v = get('min');
      let range = get('range');
      h = clamp(min_v + floor(h * range), 0.0, 255);
      tslope[jj * width + ii] = h;
    }
  }
}

function generateRiverSlope() {
  initNoise(opts.rslope);
  for (let jj = 0; jj < height; ++jj) {
    for (let ii = 0; ii < width; ++ii) {
      hexPosToUnifPos(ii, jj);

      let h = sample();
      h = clamp(floor(h * opts.rslope.steps), 0, opts.rslope.steps - 1);
      rslope[jj * width + ii] = h + 1;
    }
  }
}

function growRivers() {
  subopts = opts.river;
  river.fill(0);
  relev.fill(0);
  let coastlines = [];
  let coastlines_incdir = [];
  function findCandidates() {
    // PERF: this could be an output from the above steps - oceans and inland seas combined,
    //   would just need better random choice for initial incoming direction
    let { unfilled_seas, lake_seeds } = state;
    let todo = [];
    function tryMark(pos, v, incoming_dir) {
      let d = fill[pos];
      if (d !== D_SEA && d !== D_INLAND_SEA) {
        if (d === D_OPEN) { // land
          fill[pos] = D_COASTLINE;
          let invdir = (incoming_dir + 3) % 6;
          river[pos] = 1 << invdir;
          relev[pos] = rslope[pos];
          coastlines.push(pos);
          coastlines_incdir.push(invdir);
        }
        return;
      }
      fill[pos] = v;
      todo.push(pos);
    }
    function spreadSeas(v) {
      while (todo.length) {
        let idx = rand.range(todo.length);
        let pos = todo[idx];
        ridx(todo, idx);
        let neighbors = neighbors_bit[pos & 1];
        for (let ii = 0; ii < neighbors.length; ++ii) {
          tryMark(pos + neighbors[ii], v, ii);
        }
      }
    }
    function tryMarkXY(x, y, v) {
      tryMark(y * width + x, v || D_SEA2);
    }
    tryMarkXY(1, 1);
    tryMarkXY(width - 2, 1);
    tryMarkXY(width - 2, height - 2);
    tryMarkXY(1, height - 2);
    for (let ii = 0; ii < unfilled_seas.length; ++ii) {
      let sea = unfilled_seas[ii];
      let pos = sea[rand.range(sea.length)];
      tryMarkXY(pos % width, floor(pos / width));
    }
    spreadSeas(D_SEA2);
    state.ocean_coastlines = coastlines.slice(0); // oceans and unfilled seas, not lakes
    for (let ii = 0; ii < lake_seeds.length; ++ii) {
      let pos = lake_seeds[ii];
      tryMarkXY(pos % width, floor(pos / width), D_LAKE);
    }
    spreadSeas(D_LAKE);
  }
  findCandidates();

  function findBorderMinDist() {
    util.fill(0);
    let todo = coastlines;
    let d = 0;
    for (let ii = 0; ii < todo.length; ++ii) {
      let pos = todo[ii];
      util[pos] = 1;
    }
    while (todo.length) {
      d = min(d + 1, 255);
      let next = [];
      for (let ii = 0; ii < todo.length; ++ii) {
        let pos = todo[ii];
        let neighbors = neighbors_bit[pos & 1];
        for (let jj = 0; jj < neighbors.length; ++jj) {
          let npos = pos + neighbors[jj];
          if (!util[npos] && !land[npos]) {
            util[npos] = 1;
            if (fill[npos] === D_BORDER) {
              state.border_min_dist = d;
              return;
            } else {
              next.push(npos);
            }
          }
        }
      }
      todo = next;
    }
    assert(false);
    state.border_min_dist = 0;
  }
  findBorderMinDist();

  if (opts.early_out === 'river') {
    return;
  }

  let orig_coastlines = coastlines;
  function filterCoastalRivers() {
    let rank = [[],[],[]];
    coastlines.forEach(function (pos) {
      let neighbors = neighbors_bit[pos & 1];
      let open_count = 0;
      let open_bits = 0;
      for (let ii = 0; ii < neighbors.length; ++ii) {
        let npos = pos + neighbors[ii];
        if (!land[npos]) {
          open_bits |= 1 << ii;
          ++open_count;
        }
      }
      if (open_count >= 4) {
        return;
      }
      assert(open_count);
      if (open_count === 1) {
        // perfect
        rank[0].push(pos);
        return;
      }
      // are all open tiles adjacent?
      open_bits |= open_bits << 6;
      let bpos = 0;
      // Find something solid
      while (open_bits & (1 << bpos)) {
        bpos++;
      }
      // Find first open
      while (!(open_bits & (1 << bpos))) {
        bpos++;
      }
      let count = 0;
      // count num contiguous open
      while (open_bits & (1 << bpos)) {
        bpos++;
        ++count;
      }
      if (count !== open_count) {
        return;
      }
      let r = !rand.range(open_count === 2 ? 4 : 2);
      if (r) {
        rank[open_count - 1].push(pos);
      }
    });
    let blocked = [];
    coastlines = [];
    for (let ii = 0; ii < rank.length; ++ii) {
      let list = rank[ii];
      for (let jj = 0; jj < list.length; ++jj) {
        let pos = list[jj];
        if (blocked[pos]) {
          continue;
        }
        coastlines.push(pos);
        let neighbors = neighbors_bit[pos & 1];
        for (let kk = 0; kk < neighbors.length; ++kk) {
          let npos = pos + neighbors[kk];
          blocked[npos] = true;
        }
      }
    }
  }
  filterCoastalRivers();
  function grow() {
    const MAX_PRIORITY = 10;
    let weight_total = subopts.weight_bend + subopts.weight_sfork + subopts.weight_afork;
    let active_by_prior = [];
    let min_elev_by_prior = [];
    let tuning_h = opts.river.tuning_h;
    for (let ii = 0; ii <= MAX_PRIORITY; ++ii) {
      active_by_prior[ii] = [[]];
      min_elev_by_prior[ii] = 0;
    }
    for (let ii = 0; ii < coastlines.length; ++ii) {
      let pos = coastlines[ii];
      let p = rand.random();
      p = 1 + floor(p*p*p * MAX_PRIORITY);
      debug_priority[pos] = p;
      let active_by_elev = active_by_prior[p];
      active_by_elev[0].push(pos);
    }
    let chosen_priority;
    function chooseNode() {
      // find min elevation
      let min_elev = Infinity;
      for (let p = MAX_PRIORITY; p >= 0; --p) {
        min_elev = min(min_elev, min_elev_by_prior[p]);
      }
      for (let p = MAX_PRIORITY; p >= 0; --p) {
        let active_by_elev = active_by_prior[p];
        for (let ii = 0; ii < tuning_h; ++ii) {
          let elev = min_elev + ii;
          let active = active_by_elev[elev];
          if (active) {
            let idx = rand.range(active.length);
            let ret = active[idx];
            ridx(active, idx);
            if (!active.length) {
              // Nothing more at this (min) elevation at this priority
              delete active_by_elev[elev];
              let mep = min_elev_by_prior[p];
              assert.equal(mep, elev);
              while (!active_by_elev[mep] && mep < active_by_elev.length) {
                ++mep;
              }
              if (mep === active_by_elev.length) {
                mep = Infinity;
              }
              min_elev_by_prior[p] = mep;
            }
            chosen_priority = p;
            return ret;
          }
        }
      }
      return -1;
    }
    function validGrowth(frompos, topos) {
      // Not too high relative to neighbors?
      let new_elev = relev[frompos] + rslope[topos];
      let neighbors = neighbors_bit[topos & 1];
      for (let ii = 0; ii < neighbors.length; ++ii) {
        let npos = topos + neighbors[ii];
        if (river[npos]) {
          let d = new_elev - relev[npos];
          if (abs(d) > opts.river.max_tslope) {
            return false;
          }
        }
      }
      return true;
    }
    while (true) {
      let pos = chooseNode();
      if (pos === -1) {
        break;
      }
      // Check all 6 neighbors, find any that are expandable
      let neighbors = neighbors_bit[pos & 1];
      let options = [];
      let cur_bits = river[pos];
      let bad_bits = cur_bits | cur_bits << 1 | cur_bits >> 1 | cur_bits >> 5 | cur_bits << 5;
      for (let ii = 0; ii < neighbors.length; ++ii) {
        if ((1 << ii) & bad_bits) {
          continue;
        }
        let npos = pos + neighbors[ii];
        if (!land[npos] || river[npos]) {
          continue;
        }
        // Technically valid
        if (validGrowth(pos, npos)) {
          options.push([npos, ii]);
        }
      }
      if (!options.length) {
        // river is done, cannot expand
        continue;
      }
      let asym = false;
      if (options.length > 1) {
        let nopt = 1;
        let split = rand.range(weight_total);
        if (split >= subopts.weight_bend) {
          nopt = 2;
          if (split - subopts.weight_bend >= subopts.weight_sfork) {
            asym = true;
          }
        }
        for (let ii = 0; ii < nopt; ++ii) {
          let t = options[ii];
          let cidx = ii + rand.range(options.length - ii);
          options[ii] = options[cidx];
          options[cidx] = t;
        }
        options.length = nopt;
      }
      for (let ii = 0; ii < options.length; ++ii) {
        let npos = options[ii][0];
        let ndir = options[ii][1];
        let nelev = relev[pos] + rslope[npos];
        let p = asym ?
          ii === 1 ? chosen_priority - 1 : chosen_priority :
          options.length > 1 ? chosen_priority - 1 : chosen_priority;
        p = max(0, p);
        debug_priority[npos] = p;
        relev[npos] = nelev;
        river[npos] = 1 << ((ndir + 3) % 6);
        river[pos] |= 1 << ndir;
        min_elev_by_prior[p] = min(min_elev_by_prior[p], nelev);
        let active_by_elev = active_by_prior[p];
        let active = active_by_elev[nelev];
        if (!active) {
          active = active_by_elev[nelev] = [];
        }
        active.push(npos);
      }
    }
  }
  grow();
  function computeStrahler() {
    function fillStrahler(pos, from_dir) {
      let bits = river[pos];
      let out = [];
      for (let ii = 0; ii < 6; ++ii) {
        if (ii !== from_dir && (bits & (1 << ii))) {
          out.push(ii);
        }
      }
      let s;
      if (!out.length) {
        s = 1;
      } else {
        let neighbors = neighbors_bit[pos & 1];
        if (out.length === 1) {
          s = fillStrahler(pos + neighbors[out[0]], (out[0] + 3) % 6);
        } else {
          assert.equal(out.length, 2);
          let s1 = fillStrahler(pos + neighbors[out[0]], (out[0] + 3) % 6);
          let s2 = fillStrahler(pos + neighbors[out[1]], (out[1] + 3) % 6);
          if (s1 === s2) {
            s = s1 + 1;
          } else {
            s = max(s1, s2);
          }
        }
      }
      rstrahler[pos] = s;
      return s;
    }
    for (let ii = 0; ii < orig_coastlines.length; ++ii) {
      fillStrahler(orig_coastlines[ii], coastlines_incdir[ii]);
    }
  }
  computeStrahler();
  function pruneRivers() {
    for (let pos = 0; pos < total_size; ++pos) {
      if (rstrahler[pos] === 1) {
        let bits = river[pos];
        river[pos] = 0;
        rstrahler[pos] = 0;
        relev[pos] = 0;
        let neighbors = neighbors_bit[pos & 1];
        for (let ii = 0; ii < 6; ++ii) {
          if (bits & (1 << ii)) {
            let npos = pos + neighbors[ii];
            river[npos] &= ~(1 << ((ii + 3) % 6));
          }
        }
      }
    }
  }
  if (subopts.prune) {
    pruneRivers();
    computeStrahler();
  }
  function buildUpHeight() {
    util.fill(0);
    // Accumulate river nodes
    // Maybe also start with coastlines?
    let work_nodes = [];
    for (let pos = 0; pos < total_size; ++pos) {
      if (river[pos]) {
        work_nodes.push(pos);
      }
    }
    // Contribute from work nodes to all land neighbors
    while (work_nodes.length) {
      let next_nodes = [];
      for (let ii = 0; ii < work_nodes.length; ++ii) {
        let pos = work_nodes[ii];
        let neighbors = neighbors_bit[pos & 1];
        let nheight = relev[pos] + tslope[pos];
        for (let jj = 0; jj < neighbors.length; ++jj) {
          let npos = pos + neighbors[jj];
          if (!river[npos] && land[npos] && util[npos] !== 255) {
            if (!util[npos]) {
              relev[npos] = 0;
              next_nodes.push(npos);
            }
            relev[npos]+=nheight;
            util[npos]++;
          }
        }
      }
      // average
      for (let ii = 0; ii < next_nodes.length; ++ii) {
        let pos = next_nodes[ii];
        relev[pos] /= util[pos];
        util[pos] = 255;
      }
      work_nodes = next_nodes;
    }
  }
  buildUpHeight();
}

function generateOceanDistanceField() {
  util.fill(0);
  let todo = state.ocean_coastlines;
  let d = 0;
  for (let ii = 0; ii < todo.length; ++ii) {
    let pos = todo[ii];
    ocean_distance[pos] = d;
    util[pos] = 1;
  }
  while (todo.length) {
    d = min(d + 1, 255);
    let next = [];
    for (let ii = 0; ii < todo.length; ++ii) {
      let pos = todo[ii];
      let neighbors = neighbors_bit[pos & 1];
      for (let jj = 0; jj < neighbors.length; ++jj) {
        let npos = pos + neighbors[jj];
        if (!util[npos]) {
          util[npos] = 1;
          ocean_distance[npos] = d;
          if (fill[npos] !== D_BORDER) {
            next.push(npos);
          }
        }
      }
    }
    todo = next;
  }
  ocean_distance[0] = min(ocean_distance[1] + 1, 255);
  ocean_distance[total_size - 1] = min(ocean_distance[total_size - 2] + 1, 255);
}

function generateOcean() {
  let { border_min_dist } = state;
  initNoise(opts.ocean);
  for (let jj = 0; jj < height; ++jj) {
    for (let ii = 0; ii < width; ++ii) {
      let pos = jj * width + ii;
      if (fill[pos] === D_SEA2 || fill[pos] === D_BORDER) {
        hexPosToUnifPos(ii, jj);

        let noise_v = sample();
        let distance = clamp(ocean_distance[pos] / border_min_dist, 0, 1);
        let noise_weight = (0.5 - abs(distance - 0.5));
        distance -= noise_v * noise_weight;
        relev[pos] = clamp(distance * 255, 0, 255);
      }
    }
  }
}

function generateOutputElevation() {
  // let max_depth = 0; // always 255
  // let max_height = 0;
  // Empirical estimate on 256x256 texture, before mountainifying
  let est_max_output = opts.rslope.steps * 50 + 80;
  // covert to a height in quarter-voxels for output
  let voxel_scale = state.voxel_scale = 1 / est_max_output * opts.output.land_range / 2;
  // for (let pos = 0; pos < total_size; ++pos) {
  //   let e = relev[pos];
  //   if (land[pos]) {
  //     max_height = max(max_height, e);
  //   } else {
  //     max_depth = max(max_depth, e);
  //   }
  // }
  let above_sea_level = opts.output.sea_range;
  for (let pos = 0; pos < total_size; ++pos) {
    let e = relev[pos];
    if (land[pos]) {
      e = above_sea_level + e * voxel_scale; // (e / max_height) * opts.output.land_range;
    } else {
      e = above_sea_level - 1 - e / 255 * above_sea_level;
    }
    relev[pos] = max(0, round(e));
  }
  water_level.fill(0);
}

function fixupCoastalWaters() {
  // Hack: use average slope to calc depth of hexomes bordering coast, instead of noise
  let above_sea_level = opts.output.sea_range;
  for (let pos = 0; pos < total_size; ++pos) {
    if (fill[pos] === D_SEA2) {
      let land_count = 0;
      //let elev_sum = 0;
      let elev_min = Infinity;
      let neighbors = neighbors_bit[pos & 1];
      for (let kk = 0; kk < neighbors.length; ++kk) {
        let nidx = pos + neighbors[kk];
        if (land[nidx]) {
          ++land_count;
          let delev = relev[nidx] - above_sea_level;
          //elev_sum += delev;
          elev_min = min(elev_min, delev);
        }
      }
      if (land_count) {
        //relev[pos] = max(relev[pos], above_sea_level - max(elev_sum / land_count, 1));
        relev[pos] = max(relev[pos], above_sea_level - max(elev_min, 1));
      }
    }
  }
  // Hack: any land that is level with the water, raise up a bit so it blends well
  let { voxel_scale } = state;
  for (let pos = 0; pos < total_size; ++pos) {
    if (relev[pos] === above_sea_level && !river[pos]) {
      relev[pos] = above_sea_level + min(rslope[pos], tslope[pos]) * voxel_scale * 0.5;
    }
  }
}

function blurExtremeSlopes() {
  subopts = opts.blur;
  let { threshold, weight } = subopts;
  let blurs = [];
  for (let pos = 0; pos < total_size; ++pos) {
    if (!land[pos] || river[pos]) {
      continue;
    }
    let elev = relev[pos];
    let neighbors = neighbors_bit[pos & 1];
    let blur = false;
    for (let ii = 0; ii < neighbors.length; ++ii) {
      let nidx = pos + neighbors[ii];
      let nelev = relev[nidx];
      if (nelev - elev > threshold) {
        blur = true;
      }
    }
    if (blur) {
      let total = elev;
      for (let ii = 0; ii < neighbors.length; ++ii) {
        let nidx = pos + neighbors[ii];
        let nelev = relev[nidx];
        total += max(opts.output.sea_range, nelev);
      }
      blurs.push([pos, lerp(weight, elev, round(total / 7))]);
    }
  }
  for (let ii = 0; ii < blurs.length; ++ii) {
    let b = blurs[ii];
    relev[b[0]] = b[1];
  }
}

function fillLakes() { // Happens much later than generateLakes - after river growing!
  let { lakes } = state;
  util.fill(0);
  function fillLake(source_pos) {
    let cur_elev = relev[source_pos];
    util[source_pos] = 1;
    let neighbors_by_elev = []; // neighbors of distance 1, sorted by elevation
    let n2 = {}; // neighbors of a distance 2
    let filled = [];
    let try_elev = cur_elev;
    let good_elevations = [];
    function addPos(pos) {
      filled.push(pos);
      let neighbors = neighbors_bit[pos & 1];
      for (let jj = 0; jj < neighbors.length; ++jj) {
        let nidx = pos + neighbors[jj];
        if (!util[nidx]) {
          let nelev = relev[nidx];
          if (nelev < try_elev) {
            return false;
          }
          let ne = neighbors_by_elev[nelev];
          if (!ne) {
            ne = neighbors_by_elev[nelev] = [];
          }
          ne.push(nidx);
          util[nidx] = 1;

          // Also remove from N2
          delete n2[nidx];
          // Also add our neighbors to N2
          let neighbors2 = neighbors_bit[nidx & 1];
          for (let kk = 0; kk < neighbors2.length; ++kk) {
            let nidx2 = nidx + neighbors2[kk];
            if (!util[nidx2] && !n2[nidx2]) {
              n2[nidx2] = relev[nidx2];
            }
          }
        }
      }
      return true;
    }
    if (!addPos(source_pos)) {
      return;
    }
    // try increasing water elevation
    outer:
    do {
      ++try_elev;
      let ne = neighbors_by_elev[try_elev];
      let filled_len = filled.length;
      if (ne) {
        for (let ii = 0; ii < ne.length; ++ii) { // grows while iterating
          if (!addPos(ne[ii])) {
            filled.length = filled_len;
            break outer;
          }
        }
        // This elevation is lower than all immediate neighbors
        // This is a good elevation if it is lower than everyone in N2
        let is_good = true;
        for (let key in n2) {
          if (n2[key] <= try_elev) {
            is_good = false;
            break;
          }
        }
        if (is_good) {
          cur_elev = try_elev;
          good_elevations.push([cur_elev, filled.length]);
        }
      }
    } while (true);
    if (!good_elevations.length) {
      return;
    }
    // Aribitrary grab the elevation found halfway though the flooding process
    let pick = floor(good_elevations.length * 0.5);
    pick = good_elevations[pick];
    filled.length = pick[1];
    cur_elev = pick[0] + 1;
    for (let ii = 0; ii < filled.length; ++ii) {
      let pos = filled[ii];
      water_level[pos] = cur_elev;
      land[pos] = 0;
    }
    // lake_fills.push(filled);
    // Also spread sea level to neighboring hexomes
    for (let ii in neighbors_by_elev) {
      let elev = Number(ii);
      if (elev > cur_elev) {
        let ne = neighbors_by_elev[elev];
        for (let jj = 0; jj < ne.length; ++jj) {
          water_level[ne[jj]] = cur_elev;
        }
      }
    }
  }
  for (let ii = 0; ii < lakes.length; ++ii) {
    fillLake(lakes[ii]);
  }
}

function pruneFloodedRivers() {
  for (let ii = 0; ii < total_size; ++ii) {
    if (!river[ii]) {
      continue;
    }
    let wl = water_level[ii];
    if (wl && relev[ii] < wl) {
      river[ii] = 0;
    }
  }
}

function generateCoastDistanceField() {
  util.fill(0);
  function findCoast() {
    let default_water_level = opts.output.sea_range;
    let coast = [];
    for (let ii = 0; ii < total_size; ++ii) {
      if (relev[ii] >= (water_level[ii] || default_water_level)) {
        // it's land
        let neighbors = neighbors_bit[ii & 1];
        let is_coast = false;
        for (let jj = 0; jj < neighbors.length; ++jj) {
          let nid = ii + neighbors[jj];
          if (relev[nid] < (water_level[nid] || default_water_level)) {
            is_coast = true;
            break;
          }
        }
        if (is_coast) {
          coast.push(ii);
        }
      }
    }
    return coast;
  }
  let todo = findCoast();
  let d = 0;
  for (let ii = 0; ii < todo.length; ++ii) {
    let pos = todo[ii];
    coast_distance[pos] = d;
    util[pos] = 1;
  }
  while (todo.length) {
    d = min(d + 1, 255);
    let next = [];
    for (let ii = 0; ii < todo.length; ++ii) {
      let pos = todo[ii];
      let neighbors = neighbors_bit[pos & 1];
      for (let jj = 0; jj < neighbors.length; ++jj) {
        let npos = pos + neighbors[jj];
        if (!util[npos]) {
          util[npos] = 1;
          coast_distance[npos] = d;
          if (fill[npos] !== D_BORDER) {
            next.push(npos);
          }
        }
      }
    }
    todo = next;
  }
  coast_distance[0] = min(coast_distance[1] + 1, 255);
  coast_distance[total_size - 1] = min(coast_distance[total_size - 2] + 1, 255);
}

function mountainify() {
  subopts = opts.mountainify;
  let { cdist_ramp, peak_radius, peak_percent, peak_k } = subopts;
  let peak_candidates;
  // Generate Poisson disk sampling across map
  peak_candidates = poissonSample(peak_radius, peak_k).filter((a) => land[a]);
  function choosePeaks() {
    let peak_elev = findMaxPerRegion(peak_candidates, relev, (peak_radius / 2) | 0);
    let keep = max(1, ceil(peak_percent * peak_elev.length));
    peak_elev = peak_elev.slice(0, keep);
    return peak_elev.map((a) => a[1]);
  }
  let points = choosePeaks();

  let {
    blend_radius,
    height_scale,
    weight_local,
    power_max,
    power_min,
    power_blend,
  } = subopts;
  function growMountain(pos) {
    let rsquared = blend_radius*blend_radius;
    let horiz_radius = ceil(blend_radius * SKEW_X);
    let weight_abs = 1 - weight_local;
    let avg_height = 0;
    let avg_count = 0;
    let x0 = pos % width;
    let y0 = (pos - x0) / width;
    // Find average height under the mountain within the radius
    // PERFTODO: If constant radius, could pre-build an array of just the
    //   index-offsets of points that pass the range tests and pre-compute
    //   their weights.

    // Weighted average of entire area
    for (let dx = -horiz_radius; dx <= horiz_radius; ++dx) {
      for (let dy = -blend_radius; dy <= blend_radius; ++dy) {
        let dsq = dx*dx + dy*dy; // Not quite accurate distance, but fine for this estimate
        if (dsq >= rsquared) {
          continue;
        }
        let x = x0 + dx;
        let y = y0 + dy;
        if (x < 0 || x >= width || y < 0 || y >= height) {
          continue;
        }
        let pos_idx = y * width + x;
        if (!land[pos_idx]) {
          continue;
        }
        //let w = 1 - dsq / rsquared; // 1 in center, 0 on edge
        let w = dsq / rsquared; // 0 in center, 1 on edge
        avg_height += relev[y * width + x] * w;
        avg_count += w;
      }
    }
    avg_height /= avg_count;
    // Scale up exponentially in the middle
    let center_dh = relev[pos] - avg_height;
    if (center_dh < 10) {
      // the center is lower than the average - must have been at the edge of a peak selection radius, and
      // on a slope, so probably not actually a good choice for a exaggerated peak
      return;
    }

    // Decide which angle to apply the power curve
    // Try just perpindicular to the 3 cardinal hex-axes
    let angle_offs = PI/6;
    let best_h = 0;
    let angles = [
      [-0.5, sqrt(3/4), PI/6],
      [-1, 0, PI*3/6],
      [-0.5, -sqrt(3/4), PI*5/6],
      [0.5, -sqrt(3/4), PI*7/6],
      [1, 0, PI*9/6],
      [0.5, sqrt(3/4), PI*11/6],
    ];
    for (let ii = 0; ii < angles.length; ++ii) {
      let sx = round(x0 + angles[ii][0] * blend_radius / 2 / SKEW_X);
      let sy = round(y0 + angles[ii][1] * blend_radius / 2);
      sx = clamp(sx, 0, width - 1);
      sy = clamp(sy, 0, height - 1);
      let h = relev[sx + sy * width];
      if (h > best_h) {
        best_h = h;
        angle_offs = angles[ii][2];
      }
    }

    for (let dx = -horiz_radius; dx <= horiz_radius; ++dx) {
      for (let dy = -blend_radius; dy <= blend_radius; ++dy) {
        let x = x0 + dx;
        let y = y0 + dy;
        let unif_dx = (x - x0) / SKEW_X;
        let unif_dy = y - y0;
        if ((x0 & 1) !== (x & 1)) {
          if (x0 & 1) {
            unif_dy -= 0.5;
          } else {
            unif_dy += 0.5;
          }
        }
        let dsq = unif_dx*unif_dx + unif_dy*unif_dy;
        if (dsq >= rsquared) {
          continue;
        }
        if (x < 0 || x >= width || y < 0 || y >= height) {
          continue;
        }
        let pos_idx = y * width + x;
        if (!land[pos_idx]) {
          continue;
        }
        let elev = relev[pos_idx];
        let dh = elev - avg_height;
        let scale = 1 - sqrt(dsq) / blend_radius;
        let angle = atan2(unif_dx, unif_dy);
        // TODO: add rotate here
        angle = ((angle + angle_offs) + PI) % TWOPI - PI;
        angle = abs(angle) / PI;
        angle = clamp((angle - (1 - power_blend) / 2) / power_blend, 0, 1);
        let eff_power = lerp(angle, power_min, power_max);
        scale = pow(scale, eff_power);
        let cdist = coast_distance[pos_idx];
        if (cdist_ramp) {
          scale *= clamp(cdist / cdist_ramp, 0, 1);
        }
        let delta = (weight_local * max(0, dh) + weight_abs * center_dh) * height_scale * scale;
        mountain_delta[pos_idx] = max(mountain_delta[pos_idx], delta);
      }
    }
  }
  function applyGrowth() {
    for (let pos_idx = 0; pos_idx < total_size; ++pos_idx) {
      relev[pos_idx] += mountain_delta[pos_idx];
    }
  }

  mountain_delta.fill(0);
  for (let ii = 0; ii < points.length; ++ii) {
    growMountain(points[ii]);
  }
  applyGrowth();
}

function pruneUphillRivers() {
  // After Mountainify has changed the slopes, are any rivers now flowing uphill?
  subopts = opts.river;
  if (!subopts.mtify_prune) {
    return;
  }
  let { mtify_prune_grace } = subopts;

  function clearRiver(pos, from_dir) {
    let bits = river[pos];
    let neighbors = neighbors_bit[pos & 1];
    for (let ii = 0; ii < 6; ++ii) {
      if (ii !== from_dir && (bits & (1 << ii))) {
        clearRiver(pos + neighbors[ii], (ii + 3) % 6);
      }
    }
    rstrahler[pos] = 0;
    river[pos] = 0;
  }
  function fillStrahler(pos, from_dir) {
    let my_elev = relev[pos];
    let bits = river[pos];
    let out = [];
    let neighbors = neighbors_bit[pos & 1];
    for (let ii = 0; ii < 6; ++ii) {
      if (ii !== from_dir && (bits & (1 << ii))) {
        let nid = pos + neighbors[ii];
        if (relev[nid] < my_elev) {
          if (relev[nid] < my_elev - mtify_prune_grace) {
            river[pos] &= ~(1 << ii);
            clearRiver(nid, (ii + 3) % 6);
          } else {
            // Pretty close, just raise a bit
            relev[nid] = my_elev;
            out.push(ii);
          }
        } else {
          out.push(ii);
        }
      }
    }
    // Might as well also re-compute Strahler (just for debug)
    let s;
    if (!out.length) {
      s = 1;
    } else {
      if (out.length === 1) {
        s = fillStrahler(pos + neighbors[out[0]], (out[0] + 3) % 6);
      } else {
        assert.equal(out.length, 2);
        let s1 = fillStrahler(pos + neighbors[out[0]], (out[0] + 3) % 6);
        let s2 = fillStrahler(pos + neighbors[out[1]], (out[1] + 3) % 6);
        if (s1 === s2) {
          s = s1 + 1;
        } else {
          s = max(s1, s2);
        }
      }
    }
    rstrahler[pos] = s;
    return s;
  }

  for (let ii = 0; ii < total_size; ++ii) {
    let rbits = river[ii];
    if (!rbits) {
      continue;
    }
    let neighbors = neighbors_bit[ii & 1];
    let found_one = false;
    for (let jj = 0; jj < neighbors.length; ++jj) {
      if (rbits & (1 << jj)) {
        let nid = ii + neighbors[jj];
        if (!river[nid]) {
          assert(!found_one);
          found_one = true;
          fillStrahler(ii, jj);
          // Also, add a bit to where we flow into, to continue rivers
          // todo.push([nid, jj]);
        }
      }
    }
  }
}

function generateHumidity() {
  let total_range = opts.output.land_range; // + opts.output.sea_range; - sea isn't used for slope, for the most part
  let slope_mul = 4096 / total_range;
  function generateSlope() {
    for (let y = 0; y < height; ++y) {
      for (let x = 0; x < width; ++x) {
        let pos = y * width + x;
        if (land[pos]) {
          // hexPosToUnifPos(x, y);
          // let noise_v = sample();
          let elev = relev[pos];
          let right_slope = 0; // if positive, slopes down to the right
          let neighbors = neighbors_bit[x & 1];
          for (let ii = 1; ii < 6; ++ii) {
            if (ii === 3) {
              continue;
            }
            let npos = pos + neighbors[ii];
            let nelev = relev[npos];
            if (ii < 3) {
              right_slope += elev - nelev;
            } else {
              right_slope += nelev - elev;
            }
          }
          humidity[pos] = clamp(128 + right_slope * slope_mul, 0, 255);
        } else {
          humidity[pos] = 128;
        }
      }
    }
  }
  generateSlope();
  if (opts.humidity.show_relief) {
    return;
  }
  function blurSlope() {
    for (let y = 0; y < height; ++y) {
      for (let x = 0; x < width; ++x) {
        let pos = y * width + x;
        if (land[pos]) {
          let neighbors = neighbors_bit[x & 1];
          let total = humidity[pos];
          let count = 1;
          for (let ii = 1; ii < 6; ++ii) {
            let npos = pos + neighbors[ii];
            if (land[npos]) {
              total += humidity[npos];
              count++;
            }
          }
          humidity[pos] = round(total / count);
        }
      }
    }
  }
  blurSlope();
  function addToNoise() {
    initNoise(opts.humidity);
    for (let y = 0; y < height; ++y) {
      for (let x = 0; x < width; ++x) {
        let pos = y * width + x;
        hexPosToUnifPos(x, y);
        let noise_v = sample();
        let rainshadow = (humidity[pos] - 128) / 127;
        rainshadow = ((rainshadow >= 0) ? 0.25 : -0.25) + rainshadow * 0.75; // [-1,-0.25] or [0.25,1.0]
        let rainshadow_effect = get('rainshadow'); // [0,1]
        rainshadow *= rainshadow_effect;
        noise_v = ((noise_v + rainshadow) + rainshadow_effect) / (1 + rainshadow_effect * 2); // [0,1]
        humidity[pos] = clamp(noise_v * 255, 0, 255);
      }
    }
  }
  addToNoise();
}

function determineClassification() {
  subopts = opts.classif;
  let { cut1, cut2, blur_scale, blur_w } = subopts;

  function blurHeight() {
    let w_len = blur_w * 2 + 1;
    let w = 1 / w_len;

    let h_min = opts.output.sea_range;

    // Horizontal blur
    for (let yy = 0; yy < height; ++yy) {
      for (let xx = 0; xx <= width - w_len; ++xx) {
        let pos = xx + yy * width;
        let v = 0;
        for (let dx = 0; dx < w_len; ++dx) {
          v += max(h_min, relev[pos + dx]);
        }
        blur_temp1[pos + blur_w] = round(v * w);
      }
    }
    // Vertical blur
    for (let yy = 0; yy < height - w_len; ++yy) {
      for (let xx = blur_w; xx <= width - blur_w; ++xx) {
        let pos = xx + yy * width;
        let v = 0;
        for (let dy = 0; dy < w_len; ++dy) {
          v += blur_temp1[pos + dy * width];
        }
        blur_temp2[pos + blur_w * width] = round(v * w);
      }
    }
  }
  function classifFromDiff() {
    for (let pos = 0; pos < total_size; ++pos) {
      let c;
      if (!land[pos]) {
        c = C_WATER;
      } else {
        let elev = relev[pos];
        let blurred = blur_temp2[pos] || elev;
        let diff = elev - blurred;
        let v = diff / blur_scale;
        c = v > cut2 ? C_MOUNTAINS : v > cut1 ? C_HILLS : C_PLAINS;
      }
      classif[pos] = c;
    }
  }
  blurHeight();
  classifFromDiff();
  // Maybe also want a blur / cellular automata pass to remove islands of classification
  // Maybe want to do stuff to decrease the mountains on the coasts
}


export function continentGen(opts_in) {
  let start = Date.now();
  opts = opts_in;
  let { hex_tex_size } = opts;
  let output_debug = opts.output.debug;
  if (hex_tex_size !== last_tex_size) {
    setupWorkBuffers(hex_tex_size);
  }

  debug_priority = [];
  state = {}; // for passing misc parameters between phases
  rand = randCreate(opts.seed);

  fill.fill(0);

  generateCoastlines();
  fillSeas();
  generateLakes();
  generateTerrainSlope();
  generateRiverSlope();
  growRivers();
  generateOceanDistanceField();
  generateOcean();
  generateOutputElevation();
  fixupCoastalWaters();
  blurExtremeSlopes();
  fillLakes();
  pruneFloodedRivers();
  generateCoastDistanceField(); // includes lakes
  mountainify();
  pruneUphillRivers();
  if (opts.early_out !== 'river') {
    generateHumidity();
  }
  determineClassification();

  let ret = {
    sea_level: opts.output.sea_range,
    max_elevation: opts.output.sea_range + opts.output.land_range,
  };
  if (output_debug) {
    ret.land = land;
    ret.fill = fill;
    ret.tslope = tslope;
    ret.rslope = rslope;
    ret.river = river;
    ret.elev = relev;
    ret.water_level = water_level;
    ret.rstrahler = rstrahler;
    ret.humidity = humidity;
    ret.classif = classif;
    ret.coast_distance = coast_distance;
    ret.ocean_distance = ocean_distance;
    ret.debug_priority = debug_priority;
    ret.blur_temp1 = blur_temp1;
    ret.blur_temp2 = blur_temp2;
  } else {
    ret.elev = relev.slice(0);
    ret.humidity = humidity.slice(0);
    ret.river = river.slice(0);
    ret.water_level = water_level.slice(0);
    ret.classif = classif.slice(0);
  }
  ret.time = Date.now() - start;
  return ret;
}
