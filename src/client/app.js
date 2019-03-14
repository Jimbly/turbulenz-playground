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
flags.pixely = 'strict'; // donotcheckin
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
      info: require('./img/font/vga_16x2.json'),
      texture: 'font/vga_16x2.png',
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

  function test(dt) {
    if (!test.color_sprite) {
      test.color_sprite = VMath.v4Copy(color_white);
      test.character = {
        x: (random() * (game_width - sprite_size) + (sprite_size * 0.5)),
        y: (random() * (game_height - sprite_size) + (sprite_size * 0.5)),
      };
    }

    if (0) {
    if (flagGet('ui_test')) {
      // let clip_test = 30;
      // draw_list.clip(Z.UI_TEST - 10, Z.UI_TEST + 10, clip_test, clip_test, 320-clip_test * 2, 240-clip_test * 2);
      glov_ui_test.run(10, 10, Z.UI_TEST);
    }
    if (flagGet('font_test')) {
      glov_ui_test.runFontTest(105, 85);
    }

    test.character.dx = 0;
    test.character.dy = 0;
    if (glov_input.isKeyDown(key_codes.LEFT) || glov_input.isKeyDown(key_codes.A) ||
      glov_input.isPadButtonDown(pad_codes.LEFT)
    ) {
      test.character.dx = -1;
      sprites.animation.setState('idle_left');
    } else if (glov_input.isKeyDown(key_codes.RIGHT) || glov_input.isKeyDown(key_codes.D) ||
      glov_input.isPadButtonDown(pad_codes.RIGHT)
    ) {
      test.character.dx = 1;
      sprites.animation.setState('idle_right');
    }
    if (glov_input.isKeyDown(key_codes.UP) || glov_input.isKeyDown(key_codes.W) ||
      glov_input.isPadButtonDown(pad_codes.UP)
    ) {
      test.character.dy = -1;
    } else if (glov_input.isKeyDown(key_codes.DOWN) || glov_input.isKeyDown(key_codes.S) ||
      glov_input.isPadButtonDown(pad_codes.DOWN)
    ) {
      test.character.dy = 1;
    }

    test.character.x += test.character.dx * dt * 0.05;
    test.character.y += test.character.dy * dt * 0.05;
    let bounds = {
      x: test.character.x - sprite_size/2,
      y: test.character.y - sprite_size/2,
      w: sprite_size,
      h: sprite_size,
    };
    if (glov_input.isMouseDown() && glov_input.isMouseOver(bounds)) {
      VMath.v4Copy(color_yellow, test.color_sprite);
    } else if (glov_input.clickHit(bounds)) {
      VMath.v4Copy((test.color_sprite[2] === 0) ? color_white : color_red, test.color_sprite);
      sound_manager.play('test');
    } else if (glov_input.isMouseOver(bounds)) {
      VMath.v4Copy(color_white, test.color_sprite);
      test.color_sprite[3] = 0.5;
    } else {
      VMath.v4Copy(color_white, test.color_sprite);
      test.color_sprite[3] = 1;
    }

    draw_list.queue(sprites.game_bg, 0, 0, Z.BACKGROUND, [0, 0.72, 1, 1]);
    sprites.test_tint.drawDualTint({
      x: test.character.x,
      y: test.character.y,
      z: Z.SPRITES,
      color: [1, 1, 0, 1],
      color1: [1, 0, 1, 1],
      size: [sprite_size, sprite_size],
      frame: sprites.animation.getFrame(dt),
    });

    let font_test_idx = 0;

    glov_ui.print(glov_font.styleColored(null, 0x000000ff),
      test.character.x, test.character.y + (++font_test_idx * 20), Z.SPRITES,
      'TEXT!');
    let font_style = glov_font.style(null, {
      outline_width: 1.0,
      outline_color: 0x800000ff,
      glow_xoffs: 3.25,
      glow_yoffs: 3.25,
      glow_inner: -2.5,
      glow_outer: 5,
      glow_color: 0x000000ff,
    });
    glov_ui.print(font_style,
      test.character.x, test.character.y + (++font_test_idx * glov_ui.font_height), Z.SPRITES,
      'Outline and Drop Shadow');

    let x = glov_ui.button_height;
    let button_spacing = glov_ui.button_height + 2;
    let y = game_height - 10 - button_spacing * 5;
    if (glov_ui.buttonText({ x, y, text: `Pixely: ${flagGet('pixely') || 'Off'}`,
      tooltip: 'Toggles pixely or regular mode (requires reload)' })
    ) {
      if (flagGet('pixely') === 'strict') {
        flagSet('pixely', false);
      } else if (flagGet('pixely') === 'on') {
        flagSet('pixely', 'strict');
      } else {
        flagSet('pixely', 'on');
      }
      document.location = String(document.location);
    }
    y += button_spacing;

    if (glov_ui.buttonText({ x, y, text: `Music: ${flagGet('music') ? 'ON' : 'OFF'}`,
      tooltip: 'Toggles playing a looping background music track' })
    ) {
      flagToggle('music');
      if (flagGet('music')) {
        sound_manager.playMusic('music_test.mp3', 1, sound_manager.FADE_IN);
      } else {
        sound_manager.playMusic('music_test.mp3', 0, sound_manager.FADE_OUT);
      }
    }
    y += button_spacing;

    if (glov_ui.buttonText({ x, y, text: `Font Test: ${flagGet('font_test') ? 'ON' : 'OFF'}`,
      tooltip: 'Toggles visibility of general Font tests' })
    ) {
      flagToggle('font_test');
      glov_transition.queue(Z.TRANSITION_FINAL, glov_transition.randomTransition());
    }
    y += button_spacing;

    if (glov_ui.buttonText({ x, y, text: `UI Test: ${flagGet('ui_test') ? 'ON' : 'OFF'}`,
      tooltip: 'Toggles visibility of general UI tests' })
    ) {
      flagToggle('ui_test');
    }
    y += button_spacing;

    if (glov_ui.buttonText({ x, y, text: `Particles: ${flagGet('particles', true) ? 'ON' : 'OFF'}`,
      tooltip: 'Toggles particles' })
    ) {
      flagToggle('particles');
    }
    if (flagGet('particles')) {
      if (glov_engine.getFrameTimestamp() - last_particles > 1000) {
        last_particles = glov_engine.getFrameTimestamp();
        glov_engine.glov_particles.createSystem(particle_data.defs.explosion,
          //[test.character.x, test.character.y, Z.PARTICLES]
          [100 + random() * 120, 100 + random() * 140, Z.PARTICLES]
        );
      }
    }
    }

    if (glov_input.keyDownHit(key_codes.LEFT)) {
      auto_advance = false;
      test.terminal_countdown = 0;
      test.term_idx--;
    }
    if (glov_input.keyDownHit(key_codes.RIGHT)) {
      auto_advance = false;
      test.terminal_countdown = 0;
      test.term_idx++;
    }
    terminal.baud = glov_input.isKeyDown(key_codes.SPACE) ? 1000000000 : 9600;
    if (!test.terminal_countdown || dt >= test.terminal_countdown) {
      if (auto_advance) {
        test.term_idx = (test.term_idx || 0) + 1;
      }
      if (test.term_idx > ansi_files.length || test.term_idx <= 0) {
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
        test.terminal_countdown = 100;
      } else {
        // scroll through ansi files
        terminal.color(7,0);
        terminal.clear();
        let data = ansi_files[test.term_idx - 1];
        terminal.print({ x: 0, y: 0, text: data });
        test.terminal_countdown = 1500;
      }
    } else {
      test.terminal_countdown -= dt;
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
