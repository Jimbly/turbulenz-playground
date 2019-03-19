/*eslint global-require:off*/
/*global VMath: false */
/*global Z: false */

const glov_local_storage = require('./glov/local_storage.js');
const particle_data = require('./particle_data.js');
const fs = require('fs');

const { floor, random, min } = Math;

glov_local_storage.storage_prefix = 'glovjs-playground';
window.Z = window.Z || {};
Z.BACKGROUND = 0;
Z.SPRITES = 10;
Z.PARTICLES = 20;
Z.UI_TEST = 200;

// let app = exports;
// Virtual viewport for our game logic
export const game_width = 720;
export const game_height = 400;

export let sprites = {};

let ansi_files = [
  fs.readFileSync(`${__dirname}/ans/data0.ans`, 'binary'),
  fs.readFileSync(`${__dirname}/ans/data5.ans`, 'binary'),
  fs.readFileSync(`${__dirname}/ans/data1.ans`, 'binary'),
  fs.readFileSync(`${__dirname}/ans/data4.ans`, 'binary'),
  fs.readFileSync(`${__dirname}/ans/data2.ans`, 'binary'),
  fs.readFileSync(`${__dirname}/ans/data6.ans`, 'binary'),
  fs.readFileSync(`${__dirname}/ans/data7.ans`, 'binary'),
  fs.readFileSync(`${__dirname}/ans/data3.ans`, 'binary'),
  fs.readFileSync(`${__dirname}/ans/data8.ans`, 'binary'),
  fs.readFileSync(`${__dirname}/ans/animated.ans`, 'binary'),
];


// Persistent flags system for testing parameters
let flags = {};
flags.pixely = 'strict';
flags.music = false;
function flagGet(key, dflt) {
  if (flags[key] === undefined) {
    flags[key] = glov_local_storage.getJSON(`flag_${key}`, dflt) || false;
  }
  return flags[key];
}
function flagToggle(key) {
  flags[key] = !flagGet(key);
  glov_local_storage.setJSON(`flag_${key}`, flags[key]);
}
function flagSet(key, value) {
  flags[key] = value;
  glov_local_storage.setJSON(`flag_${key}`, flags[key]);
}

export function main(canvas) {
  const glov_engine = require('./glov/engine.js');
  const glov_font = require('./glov/font.js');
  const glov_ui_test = require('./glov/ui_test.js');
  const glov_transition = require('./glov/transition.js');
  const glov_terminal = require('./glov/terminal.js');

  glov_engine.startup({
    canvas,
    game_width,
    game_height,
    pixely: flagGet('pixely', 'strict'),
    viewport_postprocess: true,
    font: {
      info: require('./img/font/vga_16x1.json'),
      texture: 'font/vga_16x1.png',
    },
    pixel_aspect: (640/480) / (720 / 400),
    show_fps: false,
  });

  const sound_manager = glov_engine.sound_manager;
  // const glov_camera = glov_engine.glov_camera;
  const glov_input = glov_engine.glov_input;
  const glov_sprite = glov_engine.glov_sprite;
  const glov_ui = glov_engine.glov_ui;
  const draw_list = glov_engine.draw_list;
  const terminal = glov_terminal.create();
  // const font = glov_engine.font;

  // Perfect sizes for pixely modes
  glov_ui.scaleSizes(13 / 32);
  glov_ui.font_height = 16;

  const createSpriteSimple = glov_sprite.createSpriteSimple.bind(glov_sprite);
  const createAnimation = glov_sprite.createAnimation.bind(glov_sprite);

  const color_white = VMath.v4Build(1, 1, 1, 1);
  const color_red = VMath.v4Build(1, 0, 0, 1);
  const color_yellow = VMath.v4Build(1, 1, 0, 1);

  // Cache key_codes
  const key_codes = glov_input.key_codes;
  const pad_codes = glov_input.pad_codes;

  const sprite_size = 64;
  function initGraphics() {
    if (0) {
      glov_sprite.preloadParticleData(particle_data);
      sound_manager.loadSound('test');
    }

    const origin_0_0 = glov_sprite.origin_0_0;

    sprites.white = createSpriteSimple('white', 1, 1, origin_0_0);

    if (0) {
      sprites.test_tint = createSpriteSimple('tinted', [16, 16, 16, 16], [16, 16, 16], { layers: 2 });
      sprites.animation = createAnimation({
        idle_left: {
          frames: [0,1],
          times: [200, 500],
        },
        idle_right: {
          frames: [3,2],
          times: [200, 500],
        },
      });
      sprites.animation.setState('idle_left');
    }

    sprites.game_bg = createSpriteSimple('white', 2, 2, {
      width: game_width,
      height: game_height,
      origin: [0, 0],
    });
  }

  let last_particles = 0;

  let auto_advance = true;
  let term_idx = 0;
  let terminal_countdown = 0;

  function test(dt) {
    if (!test.color_sprite) {
      test.color_sprite = VMath.v4Copy(color_white);
      test.character = {
        x: (random() * (game_width - sprite_size) + (sprite_size * 0.5)),
        y: (random() * (game_height - sprite_size) + (sprite_size * 0.5)),
      };
    }

    if (glov_input.keyDownHit(key_codes.LEFT)) {
      auto_advance = false;
      terminal_countdown = 0;
      term_idx--;
    }
    if (glov_input.keyDownHit(key_codes.RIGHT)) {
      auto_advance = false;
      terminal_countdown = 0;
      term_idx++;
    }
    terminal.baud = glov_input.isKeyDown(key_codes.SPACE) ? Infinity : 9600;
    if (!terminal_countdown || dt >= terminal_countdown) {
      if (term_idx === undefined) {
        term_idx = 0;
      }
      if (auto_advance) {
        term_idx = min((term_idx || 0), ansi_files.length) + 1;
      }
      if (term_idx > ansi_files.length || term_idx <= 0) {
        // random fill
        if (!test.terminal_inited) {
          test.terminal_inited = true;
          // randomish fill
          terminal.autoScroll(false);
          terminal.moveto(0,0);
          function getch(ii, jj) { //eslint-disable-line no-inner-declarations
            return 176 + floor(random() * (224-176));
            // return 32 + ((ii * 7 + jj) % (255 - 32));
          }
          for (let ii = 0; ii < 25; ++ii) {
            let str = [ii === 0 ? '╓' : ii === 24 ? '╚' : '║']; // ║╓─╖╚═╝
            for (let jj = 1; jj < 79; ++jj) {
              if (ii === 0) {
                str.push('─');
              } else if (ii === 24) {
                str.push('═');
              } else {
                str.push(getch(ii, jj));
              }
            }
            str.push(ii === 0 ? '╖' : ii === 24 ? '╝' : '║');
            terminal.print({ x: 0, y: ii, text: str, fg: 8, bg: 0 });
          }
          terminal.moveto(0, 0);
        }

        terminal.color(floor(random() * 16), floor(random() * 8));
        let x = 1 + floor(random() * 78);
        let y = 1 + floor(random() * 23);
        terminal.fill({
          x,
          y,
          w: min(79 - x, 1 + floor(random() * 10)),
          h: min(24 - y, 1 + floor(random() * 8)),
          ch: 32 + floor(random() * (255 - 32)),
        });
        terminal_countdown = 100;
      } else {
        // scroll through ansi files
        terminal.color(7,0);
        terminal.clear();
        let data = ansi_files[term_idx - 1];
        terminal.print({ x: 0, y: 0, text: data });
        terminal_countdown = auto_advance ? 1500 : 1000000000;
      }
    } else {
      terminal_countdown -= dt;
    }

    terminal.render(dt, {
      z: Z.BACKGROUND + 1,
    });

    // Debugging touch state on mobile
    // const glov_camera = glov_engine.glov_camera;
    // glov_engine.font.drawSizedWrapped(glov_engine.fps_style, glov_camera.x0(), glov_camera.y0(), Z.FPSMETER,
    //   glov_camera.w(), 0, 22, JSON.stringify({
    //     last_touch_state: glov_input.last_touch_state,
    //     touch_state: glov_input.touch_state,
    //   }, undefined, 2));
  }

  function testInit(dt) {
    glov_engine.setState(test);
    if (flagGet('music')) {
      sound_manager.playMusic('music_test.mp3');
    }
    test(dt);
  }

  initGraphics();
  glov_engine.setState(testInit);
}
