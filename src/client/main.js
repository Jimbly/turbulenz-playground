/*eslint global-require:off, no-labels:off*/
const glov_local_storage = require('./glov/local_storage.js');
glov_local_storage.storage_prefix = 'macrogen'; // Before requiring anything else that might load from this

const assert = require('assert');
const camera2d = require('./glov/camera2d.js');
const engine = require('./glov/engine.js');
const input = require('./glov/input.js');
const { abs, max, min, floor, round, sqrt } = Math;
const net = require('./glov/net.js');
const { randCreate } = require('./glov/rand_alea.js');
const shaders = require('./glov/shaders.js');
const SimplexNoise = require('simplex-noise');
const sprites = require('./glov/sprites.js');
const textures = require('./glov/textures.js');
const ui = require('./glov/ui.js');
const { clamp, ridx } = require('../common/util.js');
const {
  vec2, v2copy, v2lengthSq, v2mul, v2sub,
  vec4,
} = require('./glov/vmath.js');

window.Z = window.Z || {};
Z.BACKGROUND = 1;
Z.SPRITES = 10;
Z.PARTICLES = 20;
Z.UI_TEST = 200;

// let app = exports;
// Virtual viewport for our game logic
export const game_width = 480;
export const game_height = 240;

export function main() {
  if (engine.DEBUG) {
    // Enable auto-reload, etc
    net.init({ engine });
  }

  if (!engine.startup({
    antialias: true,
    game_width,
    game_height,
    pixely: 'on',
    viewport_postprocess: false,
    do_borders: false,
  })) {
    return;
  }

  let shader_hex = shaders.create('shaders/hex.fp');

  // Perfect sizes for pixely modes
  ui.scaleSizes(13 / 32);
  ui.setFontHeight(8);
  let style_labels = ui.font.style({
    outline_width: 4.0,
    outline_color: 0x000000ff,
  });

  const createSprite = sprites.create;

  let hex_tex_size = 256; // 32
  let hex_param = vec4(hex_tex_size, 0, 0, 0);
  shaders.addGlobal('hex_param', hex_param);

  let modes = {
    view: 4,
    edit: 4,
  };

  let debug_tex1;
  let debug_tex2;
  let debug_sprite;
  let opts = {
    seed: 1,
    coast: {
      key: '',
      frequency: 2, // 0.1,
      amplitude: 1,
      persistence: 0.5,
      lacunarity: { min: 1.6, max: 2.8, freq: 0.3 },
      octaves: 6,
      cutoff: 0.5, // 0.22,
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
      show_elev: true,
      prune: true,
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
    humidity: {
      frequency: 2.2,
      amplitude: 1,
      persistence: 0.5,
      lacunarity: 4,
      octaves: 3,
      domain_warp: 0,
      warp_freq: 1,
      warp_amp: 1,
      rainshadow: 0.5,
    },
  };
  let tex_total_size = hex_tex_size * hex_tex_size;
  let land = new Uint8Array(tex_total_size);
  let fill = new Uint8Array(tex_total_size);
  let util = new Uint8Array(tex_total_size);
  let tslope = new Uint8Array(tex_total_size);
  let rslope = new Uint8Array(tex_total_size);
  let river = new Uint16Array(tex_total_size);
  let relev = new Uint32Array(tex_total_size);
  let rstrahler = new Uint8Array(tex_total_size);
  let coast_distance = new Uint8Array(tex_total_size);
  let humidity = new Uint8Array(tex_total_size);
  let tex_data1 = new Uint8Array(tex_total_size * 4);
  let tex_data2 = new Uint8Array(tex_total_size * 4);
  let debug_priority = [];

  function updateDebugTexture() {
    debug_priority = [];
    let start = Date.now();
    let width = hex_tex_size;
    let height = width;
    let unif_pos = vec2();
    let world_pos = vec2();

    fill.fill(0);

    let rand = randCreate(opts.seed);
    let noise;
    let noise_warp;
    let total_amplitude;
    let noise_field;
    let subopts;
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

    initNoise(opts.coast);
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

    const D_OPEN = 0;
    const D_BORDER = 1;
    const D_SEA = 2;
    const D_SEA2 = 3;
    const D_INLAND_SEA = 4;
    const D_COASTLINE = 5;

    function shuffleArray(arr) {
      for (let ii = arr.length - 1; ii >= 1; --ii) {
        let swap = rand.range(ii + 1);
        let t = arr[ii];
        arr[ii] = arr[swap];
        arr[swap] = t;
      }
    }

    const HEX_HEIGHT = 1.0; // distance between any two hexes = 1.0
    const HEX_EDGE = HEX_HEIGHT / sqrt(3);
    const HEX_WIDTH = 1.5 * HEX_EDGE;
    let count_by_h = new Array(256);
    for (let ii = 0; ii < 256; ++ii) {
      count_by_h[ii] = 0;
    }
    function hexPosToUnifPos(ii, jj) {
      world_pos[0] = ii * HEX_WIDTH;
      world_pos[1] = jj * HEX_HEIGHT - HEX_HEIGHT * 0.5;
      if (ii & 1) {
        world_pos[1] += HEX_HEIGHT * 0.5;
      }
      unif_pos[0] = world_pos[0] / ((width - 1) * HEX_WIDTH) * 2.0 - 1.0;
      unif_pos[1] = world_pos[1] / ((height - 1.5) * HEX_HEIGHT) * 2.0 - 1.0;
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
    let total_size = width * height;
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

    let id_factor = width;
    let neighbors_even = [
      id_factor, // above
      1, // upper right
      1 - id_factor, // lower right
      -id_factor, // below
      -1 - id_factor, // lower left
      -1, // upper left
    ];
    let neighbors_odd = [
      id_factor, // above
      1 + id_factor, // upper right,
      1, // lower right
      -id_factor, // below
      -1, // lower left
      -1 + id_factor, // upper left,
    ];
    function fillSeas() {
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
          let x = pos % id_factor;
          let neighbors = (x & 1) ? neighbors_odd : neighbors_even;
          for (let ii = 0; ii < neighbors.length; ++ii) {
            tryMark(pos + neighbors[ii], v);
          }
        }
      }
      tryMark(id_factor + 1, D_SEA);
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
            let x = pos % id_factor;
            let neighbors = (x & 1) ? neighbors_odd : neighbors_even;
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
            let x = pos % id_factor;
            let neighbors = (x & 1) ? neighbors_odd : neighbors_even;
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
        if (!is_ocean && subopts.fill_seas) {
          for (let ii = 0; ii < sea.length; ++ii) {
            land[sea[ii]] = 255;
            fill[sea[ii]] = D_OPEN;
          }
        }
      });
    }
    fillSeas();

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
    generateTerrainSlope();
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
    generateRiverSlope();

    let border_min_dist = 0;
    function growRivers() {
      subopts = opts.river;
      river.fill(0);
      relev.fill(0);
      let coastlines = [];
      let coastlines_incdir = [];
      function findCandidates() {
        // PERF: this could be an output from the above steps - oceans and inland seas combined,
        //   would just need better random choice for initial incoming direction
        let todo = [];
        function tryMark(pos, v, incoming_dir) {
          let d = fill[pos];
          if (d !== D_SEA) {
            if (d === D_OPEN) { // land
              fill[pos] = D_COASTLINE;
              let invdir = (incoming_dir + 3) % 6;
              river[pos] = 1 << invdir;
              relev[pos] = 0;
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
            let x = pos % id_factor;
            let neighbors = (x & 1) ? neighbors_odd : neighbors_even;
            for (let ii = 0; ii < neighbors.length; ++ii) {
              tryMark(pos + neighbors[ii], v, ii);
            }
          }
        }
        function tryMarkXY(x, y) {
          tryMark(y * id_factor + x, D_SEA2);
        }
        tryMarkXY(1, 1);
        tryMarkXY(width - 2, 1);
        tryMarkXY(width - 2, height - 2);
        tryMarkXY(1, height - 2);
        spreadSeas(D_SEA2);
      }
      findCandidates();

      function generateDF() {
        util.fill(0);
        let todo = coastlines;
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
            let x = pos % id_factor;
            let neighbors = (x & 1) ? neighbors_odd : neighbors_even;
            for (let jj = 0; jj < neighbors.length; ++jj) {
              let npos = pos + neighbors[jj];
              if (!util[npos]) {
                util[npos] = 1;
                coast_distance[npos] = d;
                if (fill[npos] === D_BORDER) {
                  if (!border_min_dist) {
                    border_min_dist = d;
                  }
                } else {
                  next.push(npos);
                }
              }
            }
          }
          todo = next;
        }
      }
      generateDF();

      if (modes.view < 3) {
        return;
      }

      let orig_coastlines = coastlines;
      function filterCoastalRivers() {
        let rank = [[],[],[]];
        coastlines.forEach(function (pos) {
          let x = pos % id_factor;
          let neighbors = (x & 1) ? neighbors_odd : neighbors_even;
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
            //river[pos] = 0;
            return;
          }
          assert(open_count);
          if (open_count === 1) {
            // perfect
            //river[pos] = 255;
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
            //river[pos] = 10;
            return;
          }
          let r = !rand.range(open_count === 2 ? 4 : 2);
          if (r) {
            rank[open_count - 1].push(pos);
            //river[pos] = 200;
          } else {
            //river[pos] = 50;
          }
        });
        let blocked = [];
        coastlines = [];
        for (let ii = 0; ii < rank.length; ++ii) {
          let list = rank[ii];
          for (let jj = 0; jj < list.length; ++jj) {
            let pos = list[jj];
            if (blocked[pos]) {
              //river[pos] = 75;
              continue;
            }
            coastlines.push(pos);
            let x = pos % id_factor;
            let neighbors = (x & 1) ? neighbors_odd : neighbors_even;
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
          let x = topos % id_factor;
          let neighbors = (x & 1) ? neighbors_odd : neighbors_even;
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
          let x = pos % id_factor;
          let neighbors = (x & 1) ? neighbors_odd : neighbors_even;
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
            let x = pos % id_factor;
            let neighbors = (x & 1) ? neighbors_odd : neighbors_even;
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
            let x = pos % id_factor;
            let neighbors = (x & 1) ? neighbors_odd : neighbors_even;
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
            let x = pos % id_factor;
            let neighbors = (x & 1) ? neighbors_odd : neighbors_even;
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
    growRivers();

    function generateOcean() {
      initNoise(opts.ocean);
      for (let jj = 0; jj < height; ++jj) {
        for (let ii = 0; ii < width; ++ii) {
          let pos = jj * width + ii;
          if (!land[pos]) {
            hexPosToUnifPos(ii, jj);

            let noise_v = sample();
            let distance = clamp(coast_distance[pos] / border_min_dist, 0, 1);
            let noise_weight = (0.5 - abs(distance - 0.5));
            distance -= noise_v * noise_weight;
            relev[pos] = clamp(distance * 255, 0, 255);
          }
        }
      }
    }
    generateOcean();

    function generateHumidity() {
      function generateSlope() {
        for (let y = 0; y < height; ++y) {
          for (let x = 0; x < width; ++x) {
            let pos = y * width + x;
            if (land[pos]) {
              // hexPosToUnifPos(x, y);
              // let noise_v = sample();
              let elev = relev[pos];
              let right_slope = 0; // if positive, slopes down to the right
              let neighbors = (x & 1) ? neighbors_odd : neighbors_even;
              for (let ii = 1; ii < 6; ++ii) {
                if (ii === 3) {
                  continue;
                }
                let npos = pos + neighbors[ii];
                let nelev = relev[npos];
                if (!land[npos]) {
                  nelev *= -0.001;
                }
                if (ii < 3) {
                  right_slope += elev - nelev;
                } else {
                  right_slope += nelev - elev;
                }
              }
              humidity[pos] = clamp(128 + 127 * right_slope / 20, 0, 255);
            } else {
              humidity[pos] = 128;
            }
          }
        }
      }
      generateSlope();
      function blurSlope() {
        for (let y = 0; y < height; ++y) {
          for (let x = 0; x < width; ++x) {
            let pos = y * width + x;
            if (land[pos]) {
              let neighbors = (x & 1) ? neighbors_odd : neighbors_even;
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
    if (modes.view >= 3) {
      generateHumidity();
    }

    // interleave data
    let tslope_min = typeof opts.tslope.min === 'object' ? opts.tslope.min.add + opts.tslope.min.mul : opts.tslope.min;
    let tslope_range = typeof opts.tslope.range === 'object' ?
      opts.tslope.range.add + opts.tslope.range.mul :
      opts.tslope.range;
    let tslope_mul = 255 / (tslope_min + tslope_range);
    for (let ii = 0; ii < tex_total_size; ++ii) {
      tex_data1[ii*4] = land[ii];
      tex_data1[ii*4+1] = fill[ii];
      tex_data1[ii*4+2] = clamp(tslope[ii] * tslope_mul, 0, 255);
      tex_data1[ii*4+3] = rslope[ii];
      tex_data2[ii*4] = river[ii];
      tex_data2[ii*4+1] = land[ii] ? opts.river.show_elev ? min(relev[ii]/opts.rslope.steps, 255) : 0 : relev[ii];
      tex_data2[ii*4+2] = rstrahler[ii];
      tex_data2[ii*4+3] = humidity[ii];
    }

    if (!debug_tex1) {
      debug_tex1 = textures.load({
        name: 'proc_gen_debug1',
        format: textures.format.RGBA8,
        width,
        height,
        data: tex_data1,
        filter_min: gl.NEAREST,
        filter_mag: gl.NEAREST,
        wrap_s: gl.CLAMP_TO_EDGE,
        wrap_t: gl.CLAMP_TO_EDGE,
      });
      debug_tex2 = textures.load({
        name: 'proc_gen_debug2',
        format: textures.format.RGBA8,
        width,
        height,
        data: tex_data2,
        filter_min: gl.NEAREST,
        filter_mag: gl.NEAREST,
        wrap_s: gl.CLAMP_TO_EDGE,
        wrap_t: gl.CLAMP_TO_EDGE,
      });
    } else {
      debug_tex1.updateData(width, height, tex_data1);
      debug_tex2.updateData(width, height, tex_data2);
    }
    if (!debug_sprite) {
      debug_sprite = createSprite({
        texs: [debug_tex1, debug_tex2],
      });
    }
    console.log(`Debug texture update in ${(Date.now() - start)}ms`);
  }

  hex_param[1] = modes.view;
  hex_param[2] = opts.rslope.steps;

  let need_regen = true;
  let debug_uvs = vec4(0,hex_tex_size + 1,hex_tex_size + 1,0);
  function test(dt) {
    camera2d.setAspectFixed2(game_width, game_height);

    if (need_regen) {
      need_regen = false;
      updateDebugTexture();
    }

    {
      const HEX_ASPECT = 1.5 / sqrt(3);
      let w = min(camera2d.w(), camera2d.h());
      let x = camera2d.x1() - w * HEX_ASPECT;
      let y = camera2d.y0();
      debug_sprite.draw({
        x, y, w, h: w,
        z: Z.UI - 10,
        uvs: debug_uvs,
        shader: shader_hex,
      });
      let mouse_pos = input.mousePos();
      if (mouse_pos[0] > x && mouse_pos[0] < x + w &&
        mouse_pos[1] > y && mouse_pos[1] < y + w
      ) {
        // convert to texcoords
        mouse_pos[0] = (mouse_pos[0] - x) / w * (hex_tex_size + 1);
        mouse_pos[1] = (1 - (mouse_pos[1] - y) / w) * (hex_tex_size + 1);

        // same in hex.fp
        const HEX_HEIGHT = 1.0;
        const VIEW_OFFS = vec2(0.5, 0.0);
        const HEX_EDGE = HEX_HEIGHT / sqrt(3.0);
        const HEX_EXTRA_WIDTH = 0.5 * HEX_EDGE; // cos(60/180*PI) * HEX_EDGE
        const HEX_WIDTH = HEX_EDGE + HEX_EXTRA_WIDTH; // 1.5 * HEX_EDGE
        const HEX_NON_EXTRA = HEX_EDGE / HEX_WIDTH; // 2/3rds
        const HEX_HEIGHT_2 = HEX_HEIGHT / 2.0; // sin(60/180*PI) (0.85) * HEX_EDGE
        const HEX_SLOPE = HEX_HEIGHT_2 / HEX_EXTRA_WIDTH;

        let fpos = v2sub(vec2(), mouse_pos, VIEW_OFFS);
        v2mul(fpos, fpos, vec2(1/HEX_WIDTH, 1/ HEX_HEIGHT));
        let ix = floor(fpos[0]);
        let odd = ix & 1;
        if (odd) {
          fpos[1] -= 0.5;
        }
        let fracx = fpos[0] - ix;
        let iy = floor(fpos[1]);
        if (fracx < HEX_NON_EXTRA) {
          // in solid section
        } else {
          // in overlapping section
          let run = ((fracx - HEX_NON_EXTRA) * HEX_WIDTH);
          let fracy = fpos[1] - iy;
          if (fracy > 0.5) {
            // in top half
            let slope = (1.0 - fracy) * HEX_HEIGHT / run;
            if (slope < HEX_SLOPE) {
              // in next over and up
              ix++;
              if (odd) {
                iy++;
              }
            }
          } else {
            // in bottom half
            let slope = (fracy * HEX_HEIGHT) / run;
            if (slope < HEX_SLOPE) {
              // in next over and down
              ix++;
              if (!odd) {
                iy--;
              }
            }
          }
        }

        if (ix >= 0 && ix < hex_tex_size && iy >= 0 && iy < hex_tex_size) {
          let z = Z.UI - 5;
          ui.print(style_labels, x, y, z, `${ix},${iy}`);
          y += ui.font_height;
          let idx = (iy * hex_tex_size + ix);
          ui.print(style_labels, x, y, z, `Land: ${land[idx]}`);
          y += ui.font_height;
          ui.print(style_labels, x, y, z, `Flags: ${fill[idx]}`);
          y += ui.font_height;
          ui.print(style_labels, x, y, z, `TSlope: ${tslope[idx]}`);
          y += ui.font_height;
          ui.print(style_labels, x, y, z, `RSlope: ${rslope[idx]}`);
          y += ui.font_height;
          ui.print(style_labels, x, y, z, `RElev: ${relev[idx]}`);
          y += ui.font_height;
          ui.print(style_labels, x, y, z, `RProir: ${debug_priority[idx]}`);
          y += ui.font_height;
          ui.print(style_labels, x, y, z, `Strahler: ${rstrahler[idx]}`);
          y += ui.font_height;
          ui.print(style_labels, x, y, z, `Humidity: ${humidity[idx]}`);
          y += ui.font_height;
          ui.print(style_labels, x, y, z, `Cost Distance: ${coast_distance[idx]}`);
          y += ui.font_height;
          let rbits = river[idx];
          ui.print(style_labels, x, y, z, `River: ${rbits&1?'Up':'  '} ${rbits&2?'UR':'  '} ` +
            `${rbits&4?'LR':'  '} ${rbits&8?'Dn':'  '} ${rbits&16?'LL':'  '} ${rbits&32?'UL':'  '}`);
          y += ui.font_height;
        }
      }
    }

    let x = ui.button_height;
    let button_spacing = ui.button_height + 2;
    let y = x;
    // if (ui.buttonText({ x, y, text: 'Regen' })) {
    //   need_regen = true;
    // }
    // y += button_spacing;

    function sliderInternal(field, value, min_v, max_v, fixed) {
      let old_value = value;
      value = ui.slider(value, {
        x, y,
        min: min_v,
        max: max_v,
      });
      if (!fixed) {
        value = round(value);
      } else if (fixed === 1) {
        value = round(value * 10) / 10;
      } else if (fixed === 2) {
        value = round(value * 100) / 100;
      }
      ui.print(style_labels, x + ui.button_width + 4, y + 3, Z.UI, `${field}: ${value.toFixed(fixed)}`);
      y += button_spacing;
      if (old_value !== value) {
        need_regen = true;
      }
      return value;
    }

    let x0 = x;
    let subopts;
    function slider(field, min_v, max_v, fixed, ex) {
      x = x0;
      let is_ex = false;
      if (ex) {
        is_ex = typeof subopts[field] === 'object';
        if (ui.buttonText({ x, y, text: is_ex ? 'v' : '-',
          w: ui.button_height })
        ) {
          is_ex = !is_ex;
          if (is_ex) {
            subopts[field] = {
              min: subopts[field],
              max: subopts[field],
              freq: 1,
            };
          } else {
            subopts[field] = subopts[field].max;
          }
          need_regen = true;
        }
        x += 16;
      }
      if (is_ex) {
        ui.print(style_labels, x, y + 3, Z.UI, `${field}`);
        y += button_spacing;
        subopts[field].min = sliderInternal('min', subopts[field].min, min_v, max_v, fixed);
        subopts[field].max = sliderInternal('max', subopts[field].max, min_v, max_v, fixed);
        subopts[field].freq = sliderInternal('freq', subopts[field].freq, 0.1, 2, 1);
      } else {
        subopts[field] = sliderInternal(field, subopts[field], min_v, max_v, fixed);
      }
    }
    function toggle(field) {
      if (ui.buttonText({ x, y, text: `${field}: ${subopts[field] ? 'ON': 'off'}` })) {
        subopts[field] = !subopts[field];
        need_regen = true;
      }
      y += button_spacing;
    }
    subopts = opts;
    slider('seed', 0, 100, 0);

    function modeButton(subkey, name, id) {
      let w = ui.button_width * 0.38;
      let colors_selected = ui.makeColorSet(vec4(0,1,0,1));
      let selected = modes[subkey] === id;
      if (ui.buttonText({
        x, y, w, text: `${name}`,
        colors: selected ? colors_selected : null,
      })) {
        modes[subkey] = id;
        hex_param[1] = modes.view;
        if (subkey === 'view') {
          need_regen = true;
        }
      }
      x += w + 2;
    }
    ui.print(style_labels, x, y + 2, Z.UI, 'View:');
    x += 25;
    modeButton('view', 'coast', 0);
    modeButton('view', 'tslope', 1);
    modeButton('view', 'rslope', 2);
    modeButton('view', 'river', 3);
    modeButton('view', 'humid', 4);
    y += button_spacing;
    x = x0;
    ui.print(style_labels, x, y + 2, Z.UI, 'Edit:');
    x += 25;
    modeButton('edit', 'coast', 0);
    modeButton('edit', 'tslope', 1);
    modeButton('edit', 'rslope', 2);
    modeButton('edit', 'river', 3);
    modeButton('edit', 'humid', 4);
    modeButton('edit', 'ocean', 5);
    y += button_spacing;
    x = x0;

    if (modes.edit === 0) {
      subopts = opts.coast;
      slider('cutoff', 0.15, 1.0, 2);
      slider('frequency', 0.1, 10, 1, true);
      //slider('amplitude', 0.01, 10, 2);
      slider('persistence', 0.01, 2, 2, true);
      slider('lacunarity', 1, 10.0, 2, true);
      slider('octaves', 1, 10, 0);
      slider('domain_warp', 0, 2, 0);
      if (subopts.domain_warp) {
        slider('warp_freq', 0.01, 3, 1);
        slider('warp_amp', 0, 2, 2);
      }
      toggle('fill_seas');
      toggle('channels');
    } else if (modes.edit === 1) {
      subopts = opts.tslope;
      slider('frequency', 0.1, 10, 1, true);
      //slider('amplitude', 0.01, 10, 2);
      slider('min', 0, 10, 0, true);
      slider('range', 0, 255, 0, true);
      slider('persistence', 0.01, 2, 2, true);
      slider('lacunarity', 1, 10.0, 2, true);
      slider('octaves', 1, 10, 0);
      slider('domain_warp', 0, 2, 0);
      if (subopts.domain_warp) {
        slider('warp_freq', 0.01, 3, 1);
        slider('warp_amp', 0, 2, 2);
      }
    } else if (modes.edit === 2) {
      subopts = opts.rslope;
      slider('frequency', 0.1, 10, 1, true);
      //slider('amplitude', 0.01, 10, 2);
      slider('persistence', 0.01, 2, 2, true);
      slider('lacunarity', 1, 10.0, 2, true);
      slider('octaves', 1, 10, 0);
      slider('domain_warp', 0, 2, 0);
      if (subopts.domain_warp) {
        slider('warp_freq', 0.01, 3, 1);
        slider('warp_amp', 0, 2, 2);
      }
      slider('steps', 1, 64, 0);
    } else if (modes.edit === 3) {
      subopts = opts.river;
      slider('weight_bend', 1, 10, 0);
      slider('weight_afork', 1, 10, 0);
      slider('weight_sfork', 1, 10, 0);
      slider('max_tslope', 1, 200, 0);
      slider('tuning_h', 1, 200, 0);
      toggle('show_elev');
      toggle('prune');
    } else if (modes.edit === 4) {
      subopts = opts.humidity;
      slider('frequency', 0.1, 10, 1, true);
      slider('persistence', 0.01, 2, 2, true);
      slider('lacunarity', 1, 10.0, 2, true);
      slider('octaves', 1, 10, 0);
      slider('domain_warp', 0, 2, 0);
      if (subopts.domain_warp) {
        slider('warp_freq', 0.01, 3, 1);
        slider('warp_amp', 0, 2, 2);
      }
      slider('rainshadow', 0, 1, 2, true);
    } else if (modes.edit === 5) {
      subopts = opts.ocean;
      slider('frequency', 0.1, 10, 1, true);
      slider('persistence', 0.01, 2, 2, true);
      slider('lacunarity', 1, 10.0, 2, true);
      slider('octaves', 1, 10, 0);
      slider('domain_warp', 0, 2, 0);
      if (subopts.domain_warp) {
        slider('warp_freq', 0.01, 3, 1);
        slider('warp_amp', 0, 2, 2);
      }
    }
    hex_param[2] = opts.rslope.steps;
  }

  function testInit(dt) {
    engine.setState(test);
    test(dt);
  }

  engine.setState(testInit);
}
