/*eslint global-require:off*/
/*global Z: false */

const glov_engine = require('./glov/engine.js');
const glov_input = require('./glov/input.js');
const glov_local_storage = require('./glov/local_storage.js');
const glov_sprites = require('./glov/sprites.js');
const glov_terminal = require('./glov/terminal.js');
const glov_ui = require('./glov/ui.js');
const fs = require('fs');

const { floor, random, min } = Math;

const { vec2, vec4, v4clone } = require('./glov/vmath.js');

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


const color_white = vec4(1, 1, 1, 1);

export function main() {
  if (!glov_engine.startup({
    game_width,
    game_height,
    pixely: 'strict',
    viewport_postprocess: true,
    font: {
      info: require('./img/font/vga_16x1.json'),
      texture: 'font/vga_16x1',
    },
    pixel_aspect: (640/480) / (720 / 400),
    show_fps: false,
  })) {
    return;
  }

  const terminal = glov_terminal.create();
  // const font = glov_engine.font;

  // Perfect sizes for pixely modes
  glov_ui.scaleSizes(13 / 32);
  glov_ui.setFontHeight(16);

  const createSprite = glov_sprites.create;

  // Cache KEYS
  const KEYS = glov_input.KEYS;

  const sprite_size = 64;
  function initGraphics() {

    sprites.white = createSprite({ url: 'white' });

    sprites.game_bg = createSprite({
      url: 'white',
      size: vec2(game_width, game_height),
    });
  }

  let auto_advance = true;
  let term_idx = 0;
  let terminal_countdown = 0;

  function test(dt) {
    if (glov_input.keyDownEdge(KEYS.LEFT)) {
      auto_advance = false;
      terminal_countdown = 0;
      term_idx--;
    }
    if (glov_input.keyDownEdge(KEYS.RIGHT)) {
      auto_advance = false;
      terminal_countdown = 0;
      term_idx++;
    }
    terminal.baud = glov_input.keyDown(KEYS.SPACE) ? Infinity : 9600;
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
  }

  function testInit(dt) {
    glov_engine.setState(test);
    test(dt);
  }

  initGraphics();
  glov_engine.setState(testInit);
}
