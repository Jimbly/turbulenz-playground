/*eslint global-require:off, no-labels:off*/
const glov_local_storage = require('./glov/local_storage.js');
glov_local_storage.storage_prefix = 'macrogen'; // Before requiring anything else that might load from this

const assert = require('assert');
const camera2d = require('./glov/camera2d.js');
const engine = require('./glov/engine.js');
const { min, floor, round, sqrt } = Math;
const net = require('./glov/net.js');
const { randCreate } = require('./glov/rand_alea.js');
const shaders = require('./glov/shaders.js');
const SimplexNoise = require('simplex-noise');
const sprites = require('./glov/sprites.js');
const textures = require('./glov/textures.js');
const ui = require('./glov/ui.js');
const { clamp } = require('../common/util.js');
const {
  vec2, v2copy, v2lengthSq,
  vec4,
} = require('./glov/vmath.js');

window.Z = window.Z || {};
Z.BACKGROUND = 1;
Z.SPRITES = 10;
Z.PARTICLES = 20;
Z.UI_TEST = 200;

// let app = exports;
// Virtual viewport for our game logic
export const game_width = 320;
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

  let hex_tex_size = 256;
  let hex_param = vec4(hex_tex_size, 0, 0, 0);
  shaders.addGlobal('hex_param', hex_param);

  let debug_texture;
  let debug_sprite;
  let opts = {
    seed: 1,
    frequency: 2,
    amplitude: 1,
    persistence: 0.5,
    lacunarity: { min: 1.6, max: 2.8, freq: 0.3 },
    octaves: 6,
    cutoff: 100,
    domain_warp: 0,
    warp_freq: 1,
    warp_amp: 0.1,
    fill_seas: true,
    channels: true,
  };
  function updateDebugTexture() {
    let start = Date.now();
    let width = hex_tex_size;
    let height = width;
    let BPP = 4;
    let data = new Uint8Array(width * height * BPP);
    let unif_pos = vec2();
    let world_pos = vec2();

    let rand = randCreate(opts.seed);
    let noise = new Array(opts.octaves);
    for (let ii = 0; ii < noise.length; ++ii) {
      noise[ii] = new SimplexNoise(`${opts.seed}n${ii}`);
    }
    let noise_warp = new Array(opts.domain_warp);
    for (let ii = 0; ii < noise_warp.length; ++ii) {
      noise_warp[ii] = new SimplexNoise(`${opts.seed}w${ii}`);
    }
    let noise_field = {};

    let total_amplitude = 0;  // Used for normalizing result to 0.0 - 1.0
    {
      let amp = opts.amplitude;
      let p = opts.persistence && opts.persistence.max || opts.persistence;
      for (let ii=0; ii<opts.octaves; ii++) {
        total_amplitude += amp;
        amp *= p;
      }
    }
    let sample_pos = vec2();
    for (let f in opts) {
      let v = opts[f];
      if (typeof v === 'object') {
        noise_field[f] = new SimplexNoise(`${opts.seed}f${f}`);
        v.mul = (v.max - v.min) * 0.5;
        v.add = v.min + v.mul;
      }
    }
    function get(field) {
      let v = opts[field];
      if (typeof v !== 'object') {
        return v;
      }
      return v.add + v.mul * noise_field[field].noise2D(sample_pos[0] * v.freq, sample_pos[1] * v.freq);
    }
    function sample() {
      v2copy(sample_pos, unif_pos);
      let warp_freq = opts.warp_freq;
      let warp_amp = opts.warp_amp;
      for (let ii = 0; ii < opts.domain_warp; ++ii) {
        let dx = noise_warp[ii].noise2D(sample_pos[0] * warp_freq, sample_pos[1] * warp_freq);
        let dy = noise_warp[ii].noise2D((sample_pos[0] + 7) * warp_freq, sample_pos[1] * warp_freq);
        sample_pos[0] += dx * warp_amp;
        sample_pos[1] += dy * warp_amp;
      }
      let total = 0;
      let amp = opts.amplitude;
      let freq = get('frequency');
      let p = get('persistence');
      let lac = get('lacunarity');
      for (let i=0; i<opts.octaves; i++) {
        total += (0.5 + 0.5 * noise[i].noise2D(sample_pos[0] * freq, sample_pos[1] * freq)) * amp;
        amp *= p;
        freq *= lac;
      }
      return total/total_amplitude;
    }

    function setColor(x, y, r, g, b, a) {
      let offs = (y * width + x) * 4;
      data[offs] = r;
      data[offs+1] = g;
      data[offs+2] = b;
      data[offs+3] = a;
    }
    const HEX_HEIGHT = 1.0; // distance between any two hexes = 1.0
    const HEX_EDGE = HEX_HEIGHT / sqrt(3);
    const HEX_WIDTH = 1.5 * HEX_EDGE;
    for (let jj = 0; jj < height; ++jj) {
      for (let ii = 0; ii < width; ++ii) {
        world_pos[0] = ii * HEX_WIDTH;
        world_pos[1] = jj * HEX_HEIGHT - HEX_HEIGHT * 0.5;
        if (ii & 1) {
          world_pos[1] += HEX_HEIGHT * 0.5;
        }
        unif_pos[0] = world_pos[0] / ((width - 1) * HEX_WIDTH) * 2.0 - 1.0;
        unif_pos[1] = world_pos[1] / ((height - 1.5) * HEX_HEIGHT) * 2.0 - 1.0;

        let h = sample(); // random()
        let cutoff = get('cutoff');
        //let cutoff_scale = cutoff / 255; // scale cutoff to extend nearer to edge of maps
        //h *= cutoff_scale + (1 - cutoff_scale) * (1 - v2lengthSq(unif_pos));
        h *= 1 - v2lengthSq(unif_pos);

        h = clamp(floor(h * 255), 0.0, 255);
        setColor(ii, jj, h > cutoff ? 255 : 0, 0, 0, 0);
      }
    }

    function fillSeas() {
      let id_factor = width;
      let todo = [];
      let done = [];
      function fillBorders() {
        for (let ii = 0; ii < width; ++ii) {
          data[ii * BPP + 1] = 2;
          data[((height - 1) * width + ii) * BPP + 1] = 2;
        }
        for (let ii = 0; ii < height; ++ii) {
          data[width * ii * BPP + 1] = 2;
          data[(width * ii + width - 1) * BPP + 1] = 2;
        }
      }
      fillBorders();
      function tryMark(pos, v) {
        if (data[pos * BPP] || data[pos * BPP + 1]) {
          return;
        }
        data[pos * BPP + 1] = v;
        todo.push(pos);
        done.push(pos);
      }
      let neighbors_even = [
        -id_factor, id_factor, // above, below
        -1, -1 - id_factor, // upper left, lower left
        1, 1 - id_factor, // upper right, lower right
      ];
      let neighbors_odd = [
        -id_factor, id_factor, // above, below
        -1 + id_factor, -1,  // upper left, lower left
        1 + id_factor, 1, // upper right, lower right
      ];
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
      tryMark(id_factor + 1, 1);
      spreadSeas(1);
      // Find all inland seas, mark them, then grow them N steps to either find a channel or fill them
      let inland_seas = [];
      for (let idx=0, pos = 0; pos < width * height; ++pos, idx += BPP) {
        if (!data[idx] && !data[idx + 1]) {
          // open, and not an ocean or previously marked
          done = [];
          tryMark(pos, 3);
          spreadSeas(3);
          inland_seas.push(done);
        }
      }
      function shuffleArray(arr) {
        for (let ii = arr.length - 1; ii >= 1; --ii) {
          let swap = rand.range(ii + 1);
          let t = arr[ii];
          arr[ii] = arr[swap];
          arr[swap] = t;
        }
      }
      shuffleArray(inland_seas);
      inland_seas.forEach(function (sea) {
        // Channel to ocean if possible
        let is_ocean = false;
        if (opts.channels) {
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
              if (!checked[npos] && !data[npos * BPP] && data[npos * BPP + 1] === 1) {
                // open route to the ocean!
                data[pos*BPP] = 0;
                sea.push(pos);
                data[npos*BPP] = 0;
                sea.push(npos);
                for (let jj = 0; jj < sea.length; ++jj) {
                  data[sea[jj]*BPP + 1] = 1;
                }
                is_ocean = true;
                break outer;
              }
            }
          }
        }
        if (!is_ocean && opts.fill_seas) {
          for (let ii = 0; ii < sea.length; ++ii) {
            data[sea[ii] * BPP] = 255;
            data[sea[ii] * BPP + 1] = 0;
          }
        }
      });
    }
    fillSeas();

    if (!debug_texture) {
      debug_texture = textures.load({
        name: 'proc_gen_debug',
        format: textures.format.RGBA8,
        width,
        height,
        data,
        filter_min: gl.NEAREST,
        filter_mag: gl.NEAREST,
        wrap_s: gl.CLAMP_TO_EDGE,
        wrap_t: gl.CLAMP_TO_EDGE,
      });
    } else {
      debug_texture.updateData(width, height, data);
    }
    if (!debug_sprite) {
      debug_sprite = createSprite({
        texs: [debug_texture],
      });
    }
    console.log(`Debug texture update in ${(Date.now() - start)}ms`);
  }

  let need_regen = true;
  let debug_uvs = vec4(0,hex_tex_size + 1,hex_tex_size + 1,0);
  function test(dt) {
    camera2d.setAspectFixed2(game_width, game_height);

    if (need_regen) {
      need_regen = false;
      updateDebugTexture();
    }

    let debug_w = min(camera2d.w(), camera2d.h());
    debug_sprite.draw({
      x: camera2d.x1() - debug_w, y: camera2d.y0(),
      w: debug_w, h: debug_w,
      uvs: debug_uvs,
      shader: shader_hex,
    });

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
      ui.print(style_labels, x + ui.button_width + 4, y, Z.UI, `${field}: ${value.toFixed(fixed)}`);
      y += button_spacing;
      if (old_value !== value) {
        need_regen = true;
      }
      return value;
    }

    let x0 = x;
    function slider(field, min_v, max_v, fixed, ex) {
      x = x0;
      let is_ex = false;
      if (ex) {
        is_ex = typeof opts[field] === 'object';
        if (ui.buttonText({ x, y, text: is_ex ? 'v' : '-',
          w: ui.button_height })
        ) {
          is_ex = !is_ex;
          if (is_ex) {
            opts[field] = {
              min: opts[field],
              max: opts[field],
              freq: 1,
            };
          } else {
            opts[field] = opts[field].max;
          }
          need_regen = true;
        }
        x += 16;
      }
      if (is_ex) {
        ui.print(style_labels, x, y, Z.UI, `${field}`);
        y += button_spacing;
        opts[field].min = sliderInternal('min', opts[field].min, min_v, max_v, fixed);
        opts[field].max = sliderInternal('max', opts[field].max, min_v, max_v, fixed);
        opts[field].freq = sliderInternal('freq', opts[field].freq, 0.1, 2, 1);
      } else {
        opts[field] = sliderInternal(field, opts[field], min_v, max_v, fixed);
      }
    }
    function toggle(field) {
      if (ui.buttonText({ x, y, text: `${field}: ${opts[field] ? 'ON': 'off'}` })) {
        opts[field] = !opts[field];
        need_regen = true;
      }
      y += button_spacing;
    }
    slider('seed', 0, 100, 0);
    slider('cutoff', 3, 255, 0, true);
    slider('frequency', 0.1, 10, 1, true);
    //slider('amplitude', 0.01, 10, 2);
    slider('persistence', 0.01, 2, 2, true);
    slider('lacunarity', 1, 10.0, 2, true);
    slider('octaves', 1, 10, 0);
    slider('domain_warp', 0, 2, 0);
    if (opts.domain_warp) {
      slider('warp_freq', 0.01, 3, 1);
      slider('warp_amp', 0, 2, 2);
    }
    toggle('fill_seas');
    toggle('channels');
  }

  function testInit(dt) {
    engine.setState(test);
    test(dt);
  }

  engine.setState(testInit);
}
