/*eslint global-require:off, no-labels:off*/
const glov_local_storage = require('./glov/local_storage.js');
glov_local_storage.storage_prefix = 'macrogen'; // Before requiring anything else that might load from this

const assert = require('assert');
const { calculateBiomesTest } = require('./biome_test.js');
const camera2d = require('./glov/camera2d.js');
const continent_gen = require('./continent_gen.js');
const { continentDeserialize, continentSerialize } = require('./continent_serialize.js');
const { continentSerializeTest } = require('./continent_serialize_test.js');
const {
  continentGen,
  // D_OPEN,
  D_BORDER,
  // D_SEA,
  D_SEA2,
  D_INLAND_SEA,
  D_COASTLINE,
  D_LAKE,
} = continent_gen;
const engine = require('./glov/engine.js');
const input = require('./glov/input.js');
const { linkText } = require('./glov/link.js');
const { min, floor, round, sqrt } = Math;
const net = require('./glov/net.js');
const shaders = require('./glov/shaders.js');
const sprites = require('./glov/sprites.js');
const textures = require('./glov/textures.js');
const ui = require('./glov/ui.js');
const { clamp, clone } = require('../common/util.js');
const {
  vec2, v2mul, v2sub,
  v3set,
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

  assert(window.worldsModAPI);
  let mapi = window.worldsModAPI({
    // For testing against local build:
    // hosts: {
    //   debug3000: 'http://localhost:3000/'
    // },
  });

  let shader_hex = shaders.create('shaders/hex.fp');

  // Perfect sizes for pixely modes
  ui.scaleSizes(13 / 32);
  ui.setFontHeight(8);
  let style_labels = ui.font.style({
    outline_width: 4.0,
    outline_color: 0x000000ff,
  });

  let style_link = ui.font.style(null, {
    color: 0x5040FFff,
    outline_width: 4.0,
    outline_color: 0x00000020,
  });
  let style_link_hover = ui.font.style(null, {
    color: 0x0000FFff,
    outline_width: 4.0,
    outline_color: 0x00000020,
  });

  const createSprite = sprites.create;

  let modes = {
    view: 3,
    edit: 0,
  };

  let debug_tex1;
  let debug_tex2;
  let debug_sprite;
  let opts = clone(continent_gen.default_opts);
  let hex_tex_size = opts.hex_tex_size;
  let tex_total_size = hex_tex_size * hex_tex_size;
  opts.output.debug = true;

  let hex_param = vec4(hex_tex_size, 0, 0, 0);
  shaders.addGlobal('hex_param', hex_param);

  let tex_data1 = new Uint8Array(tex_total_size * 4);
  let tex_data_color = new Uint8Array(tex_total_size * 4);

  let test_export = false;

  let color = vec4(0,0,0,1);
  function updateDebugTexture(cdata) {
    let start = Date.now();
    let view_mode = modes.view;
    let {
      land, fill, tslope, rslope, river, elev, water_level,
      rstrahler, humidity, classif, time,
    } = cdata;
    let width = hex_tex_size;
    let height = width;

    function seaColor(pos) {
      return elev[pos] / (water_level[pos] || opts.output.sea_range);
    }

    function setColorBuffer(buf, scale, do_ocean) {
      for (let ii = 0; ii < tex_total_size; ++ii) {
        if (land[ii]) {
          let v = clamp(buf[ii] * scale, 0, 255);
          tex_data_color[ii * 4] = v;
          tex_data_color[ii * 4 + 1] = v;
          tex_data_color[ii * 4 + 2] = v;
        } else {
          tex_data_color[ii * 4] = 0;
          tex_data_color[ii * 4 + 1] = 0;
          tex_data_color[ii * 4 + 2] = seaColor(ii) * 255;
        }
        tex_data_color[ii * 4 + 3] = 255;
      }
    }

    if (view_mode === 0) {
      for (let ii = 0; ii < tex_total_size; ++ii) {
        let landv = land[ii] ? 1 : 0;
        v3set(color, landv, landv, landv);
        let f = fill[ii];
        if (f > 0) {
          if (f === D_COASTLINE) {
            v3set(color, 0.8, 0.7, 0.3);
          } else if (f === D_INLAND_SEA) {
            color[1] = 0.25;
            color[2] = 1.0;
          } else if (f === D_BORDER) {
            color[0] = 1.0;
            color[2] = 0.5;
          } else if (f <= D_SEA2) {
            color[2] = 1;
          } else if (f === D_LAKE) {
            color[0] = color[1] = 0.25;
            color[2] = 1;
          }
        }
        for (let jj = 0; jj < 4; ++jj) {
          tex_data_color[ii * 4 + jj] = clamp(color[jj] * 255, 0, 255);
        }
      }
    } else if (view_mode === 1) {
      let tslope_min = typeof opts.tslope.min === 'object' ? opts.tslope.min.add + opts.tslope.min.mul :opts.tslope.min;
      let tslope_range = typeof opts.tslope.range === 'object' ?
        opts.tslope.range.add + opts.tslope.range.mul :
        opts.tslope.range;
      let tslope_mul = 255 / (tslope_min + tslope_range);
      setColorBuffer(tslope, tslope_mul);
    } else if (view_mode === 2) {
      setColorBuffer(rslope, 255 / opts.rslope.steps);
    } else if (view_mode === 3) {
      for (let ii = 0; ii < tex_total_size; ++ii) {
        if (land[ii]) {
          let v = opts.river.show_elev ?
            (elev[ii] - opts.output.sea_range) / opts.output.land_range :
            0;
          v3set(color, v, v, v);
        } else {
          v3set(color, 0, 0, seaColor(ii));
        }
        for (let jj = 0; jj < 4; ++jj) {
          tex_data_color[ii * 4 + jj] = clamp(color[jj] * 255, 0, 255);
        }
      }
    } else if (view_mode === 4) {
      setColorBuffer(humidity, 1);
    } else if (view_mode === 5) {
      calculateBiomesTest(width, cdata, tex_data_color);
      if (opts.classif.show_rivers) {
        view_mode = 3;
      }
    } else if (view_mode === 6) {
      for (let pos = 0; pos < tex_total_size; ++pos) {
        let c = classif[pos];
        v3set(color, c > 1 ? 255 : 0, c && c < 3 ? 255 : 0, c ? 0 : 255);
        for (let jj = 0; jj < 4; ++jj) {
          tex_data_color[pos * 4 + jj] = color[jj];
        }
      }
      if (opts.classif.show_rivers) {
        view_mode = 3;
      }
    }

    // interleave data
    for (let ii = 0; ii < tex_total_size; ++ii) {
      tex_data1[ii*4] = river[ii];
      tex_data1[ii*4+1] = rstrahler[ii];
      tex_data1[ii*4+2] = 0;
      tex_data1[ii*4+3] = 0;
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
        name: 'proc_gen_debug3',
        format: textures.format.RGBA8,
        width,
        height,
        data: tex_data_color,
        filter_min: gl.NEAREST,
        filter_mag: gl.NEAREST,
        wrap_s: gl.CLAMP_TO_EDGE,
        wrap_t: gl.CLAMP_TO_EDGE,
      });
    } else {
      debug_tex1.updateData(width, height, tex_data1);
      debug_tex2.updateData(width, height, tex_data_color);
    }
    if (!debug_sprite) {
      debug_sprite = createSprite({
        texs: [debug_tex1, debug_tex2],
      });
    }
    console.log(`Debug texture update in ${(Date.now() - start + time)}ms`);
    hex_param[1] = view_mode;
  }

  let serialize_size;
  function doExport(cdata) {
    if (0) {
      continentSerializeTest(cdata);
    } else if (0) {
      // Send to server
      let start = Date.now();
      let ser = continentSerialize(cdata);
      console.log(`Serialized in ${Date.now() - start}ms`);
      start = Date.now();
      serialize_size = ser.length;
      /*let deser =*/ continentDeserialize(ser);
      console.log(`Deserialized in ${Date.now() - start}ms`);
      let pak = net.client.wsPak('export');
      pak.writeBuffer(ser);
      pak.send();
    } else {
      // Send to WorldsFRVR via Mod API
      // Expects the raw (unserialized) data in the form:
      //   {
      //     sea_level: 8192,
      //     max_elevation: 24576,
      //     elev: new Uint16Array(256*256),
      //     humidity: new Uint8Array(256*256),
      //     river: new Uint8Array(256*256),
      //     water_level: new Uint16Array(256*256),
      //     classif: new Uint8Array(256*256),
      //   };
      mapi.continentDataSet(cdata);
    }
  }

  let need_regen = true;
  let debug_uvs = vec4(0,hex_tex_size + 1,hex_tex_size + 1,0);
  let cdata;
  function test(dt) {
    camera2d.setAspectFixed2(game_width, game_height);

    if (need_regen) {
      need_regen = false;
      opts.early_out = modes.view < 3 ? 'river' : null;
      cdata = continentGen(opts);
      updateDebugTexture(cdata);
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
          let {
            land, fill, tslope, rslope, river, elev, debug_priority,
            coast_distance, ocean_distance, sea_level,
            rstrahler, humidity,
          } = cdata;
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
          ui.print(style_labels, x, y, z, `RElev: ${elev[idx] - sea_level}`);
          y += ui.font_height;
          ui.print(style_labels, x, y, z, `RProir: ${debug_priority[idx]}`);
          y += ui.font_height;
          ui.print(style_labels, x, y, z, `Strahler: ${rstrahler[idx]}`);
          y += ui.font_height;
          ui.print(style_labels, x, y, z, `Humidity: ${humidity[idx]}`);
          y += ui.font_height;
          ui.print(style_labels, x, y, z, `Coast Distance: ${coast_distance[idx]} / ${ocean_distance[idx]}`);
          y += ui.font_height;
          // ui.print(style_labels, x, y, z, `blur_temp1: ${blur_temp1[idx] - opts.output.sea_range}`);
          // y += ui.font_height;
          // ui.print(style_labels, x, y, z, `blur_temp2: ${blur_temp2[idx] - opts.output.sea_range}`);
          // y += ui.font_height;
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
        if (subkey === 'view') {
          need_regen = true;
        }
      }
      x += w + 2;
    }
    ui.print(style_labels, x, y + 2, Z.UI, 'View:');
    x += 25;
    let aspect = engine.width / engine.height;
    let num_rows = aspect > 1.9 ? 1 : 2;
    modeButton('view', 'coast', 0);
    modeButton('view', 'tslope', 1);
    modeButton('view', 'rslope', 2);
    modeButton('view', 'river', 3);
    if (num_rows === 2) {
      y += button_spacing;
      x = x0 + 25;
    }
    modeButton('view', 'humid', 4);
    modeButton('view', 'classif', 6);
    modeButton('view', 'biomes', 5);
    y += button_spacing;
    x = x0;
    ui.print(style_labels, x, y + 2, Z.UI, 'Edit:');
    x += 25;
    num_rows = aspect > 1.77 ? 2 : 3;
    modeButton('edit', 'coast', 0);
    modeButton('edit', 'tslope', 1);
    modeButton('edit', 'rslope', 2);
    modeButton('edit', 'river', 3);
    if (num_rows === 3) {
      y += button_spacing;
      x = x0 + 25;
    }
    modeButton('edit', 'lakes', 8);
    modeButton('edit', 'blur', 9);
    if (num_rows === 2) {
      y += button_spacing;
      x = x0 + 25;
    }
    modeButton('edit', 'mtify', 7);
    modeButton('edit', 'humid', 4);
    if (num_rows === 3) {
      y += button_spacing;
      x = x0 + 25;
    }
    modeButton('edit', 'ocean', 5);
    modeButton('edit', 'classif', 10);
    modeButton('edit', 'output', 6);
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
      toggle('mtify_prune');
      if (subopts.mtify_prune) {
        slider('mtify_prune_grace', 0, 200, 0);
      }
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
      toggle('show_relief');
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
    } else if (modes.edit === 6) {
      subopts = opts.output;
      slider('sea_range_exp', 6, 15, 0);
      slider('land_range_exp', 6, 15, 0);
      subopts.sea_range = 1 << subopts.sea_range_exp;
      subopts.land_range = 1 << subopts.land_range_exp;

      if (mapi.connected()) {
        ui.print(style_labels, x, y, Z.UI, `WorldsModAPI connected to ${mapi.connected()}`);
        y += ui.font_height + 2;
        if (ui.buttonText({ x, y, text: 'Export' }) || test_export) {
          test_export = false;
          opts.output.debug = false;
          doExport(continentGen(opts));
          opts.output.debug = true;
        }
        y += button_spacing;
        if (serialize_size) {
          ui.print(style_labels, x, y, Z.UI, 'Data exported! Create a New World to use this data.');
          y += ui.font_height + 2;
          ui.print(style_labels, x, y, Z.UI, `Size: ${serialize_size}`);
          y += ui.font_height + 2;
        }
      } else {
        ui.print(style_labels, x, y, Z.UI, 'To export, open Worlds FRVR');
        y += ui.font_height + 2;
        linkText({
          style_link, style_link_hover,
          x, y,
          url: 'https://worlds.frvr.com/',
        });
      }
    } else if (modes.edit === 7) {
      subopts = opts.mountainify;
      slider('peak_radius', 2, 50, 0);
      slider('peak_percent', 0, 1, 2);
      slider('peak_k', 1, 10, 0);
      slider('blend_radius', 2, 50, 0);
      slider('height_scale', 0, 8, 1);
      slider('weight_local', 0, 1, 2);
      slider('power_min', 1, 8, 1);
      slider('power_max', 1, 8, 1);
      slider('power_blend', 0.01, 1, 2);
      slider('cdist_ramp', 0, 50, 0);
    } else if (modes.edit === 8) {
      subopts = opts.lakes;
      slider('lake_search_radius', 2, 50, 0);
      slider('lake_percent', 0, 1, 2);
      slider('lake_k', 1, 10, 0);
      slider('min_sep', 2, 50, 0);
    } else if (modes.edit === 9) {
      subopts = opts.blur;
      slider('threshold', 1, 2000, 0);
      slider('weight', 0, 1, 2);
    } else if (modes.edit === 10) {
      subopts = opts.classif;
      slider('cut1', -1, 1, 3);
      slider('cut2', 0, 1, 3);
      slider('blur_w', 1, 10, 0);
      slider('blur_scale', 0, 1000, 0);
      toggle('show_rivers');
    }
  }

  function testInit(dt) {
    engine.setState(test);
    test(dt);
  }

  engine.setState(testInit);
}
