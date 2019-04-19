/*eslint global-require:off*/
/*global Z: false */

const glov_engine = require('./glov/engine.js');
const glov_font = require('./glov/font.js');
const glov_input = require('./glov/input.js');
const glov_local_storage = require('./glov/local_storage.js');
const glov_particles = require('./glov/particles.js');
const glov_sprites = require('./glov/sprites.js');
const glov_sprite_animation = require('./glov/sprite_animation.js');
const glov_transition = require('./glov/transition.js');
const glov_ui = require('./glov/ui.js');
const glov_ui_test = require('./glov/ui_test.js');
const particle_data = require('./particle_data.js');

const { vec2, vec4, v4clone, v4copy } = require('./glov/vmath.js');

glov_local_storage.storage_prefix = 'glovjs-playground';
window.Z = window.Z || {};
Z.BACKGROUND = 0;
Z.SPRITES = 10;
Z.PARTICLES = 20;
Z.UI_TEST = 200;

// let app = exports;
// Virtual viewport for our game logic
export const game_width = 320;
export const game_height = 240;

export let sprites = {};

// Persistent flags system for testing parameters
let flags = {};
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

const color_white = vec4(1, 1, 1, 1);

function perfTestSprites() {
  if (!sprites.test) {
    sprites.test = [
      glov_sprites.create({ name: 'test', size: vec2(1, 1), origin: vec2(0.5, 0.5) }),
      glov_sprites.create({ url: 'img/test.png?1', size: vec2(1, 1), origin: vec2(0.5, 0.5) }),
    ];
  }

  let mode = 2;
  let count = [
    80000, // one sprite, pre-sorted
    40000, // one sprite, unsorted
    20000, // two sprites, unsorted, small batches
    60000, // two sprites, sorted, bigger batches, sprite API
    60000, // two sprites, sorted, bigger batches, raw API
  ][mode];
  if (mode === 3 || mode === 4) {
    for (let ii = 0; ii < count;) {
      let subc = Math.floor(500 + Math.random() * 100);
      let idx = mode <= 1 ? 0 : Math.round(Math.random());
      let sprite = sprites.test[idx];
      let z = Math.random();
      for (let jj = 0; jj < subc; ++jj) {
        if (mode === 4) {
          // glov_sprites.queueraw(sprite.texs,
          //   Math.random() * game_width - 3, Math.random() * game_height - 3, z,
          //   6, 6, 0, 0, 1, 1, color_white);
          glov_sprites.queuesprite(sprite,
            Math.random() * game_width, Math.random() * game_height, z,
            6 * sprite.size[0], 6 * sprite.size[1], 0, sprite.uvs, color_white);
        } else {
          sprites.test[idx].draw({
            x: Math.random() * game_width,
            y: Math.random() * game_height,
            z,
            w: 6, h: 6,
          });
        }
      }
      ii += subc;
    }
  } else {
    for (let ii = 0; ii < count; ++ii) {
      let idx = mode <= 1 ? 0 : Math.round(Math.random());
      sprites.test[idx].draw({
        x: Math.random() * game_width,
        y: Math.random() * game_height,
        z: mode === 0 ? ii : Math.random(),
        w: 6, h: 6,
      });
    }
  }
}

export function main(canvas) {

  glov_engine.startup({
    canvas,
    game_width,
    game_height,
    pixely: flagGet('pixely', 'on'),
    viewport_postprocess: true,
  });

  const sound_manager = glov_engine.sound_manager;
  // const font = glov_engine.font;

  // Perfect sizes for pixely modes
  glov_ui.scaleSizes(13 / 32);
  glov_ui.setFontHeight(8);

  const createSprite = glov_sprites.create;
  const createAnimation = glov_sprite_animation.create;

  const color_red = vec4(1, 0, 0, 1);
  const color_yellow = vec4(1, 1, 0, 1);

  // Cache KEYS
  const KEYS = glov_input.KEYS;
  const pad_codes = glov_input.pad_codes;

  const sprite_size = 64;
  function initGraphics() {
    glov_particles.preloadParticleData(particle_data);

    sound_manager.loadSound('test');

    sprites.white = createSprite({ url: 'white' });

    sprites.test_tint = createSprite({
      name: 'tinted',
      ws: [16, 16, 16, 16],
      hs: [16, 16, 16],
      size: vec2(sprite_size, sprite_size),
      layers: 2,
      origin: vec2(0.5, 0.5),
    });
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

    sprites.game_bg = createSprite({
      url: 'white',
      size: vec2(game_width, game_height),
    });
  }

  let last_particles = 0;

  function test(dt) {
    if (!test.color_sprite) {
      test.color_sprite = v4clone(color_white);
      test.character = {
        x: (Math.random() * (game_width - sprite_size) + (sprite_size * 0.5)),
        y: (Math.random() * (game_height - sprite_size) + (sprite_size * 0.5)),
      };
    }

    if (flagGet('ui_test')) {
      // let clip_test = 30;
      // glov_sprites.clip(Z.UI_TEST - 10, Z.UI_TEST + 10, clip_test, clip_test, 320-clip_test * 2, 240-clip_test * 2);
      glov_ui_test.run(10, 10, Z.UI_TEST);
    }
    if (flagGet('font_test')) {
      glov_ui_test.runFontTest(105, 85);
    }

    test.character.dx = 0;
    test.character.dy = 0;
    if (glov_input.keyDown(KEYS.LEFT) || glov_input.keyDown(KEYS.A) ||
      glov_input.padButtonDown(pad_codes.LEFT)
    ) {
      test.character.dx = -1;
      sprites.animation.setState('idle_left');
    } else if (glov_input.keyDown(KEYS.RIGHT) || glov_input.keyDown(KEYS.D) ||
      glov_input.padButtonDown(pad_codes.RIGHT)
    ) {
      test.character.dx = 1;
      sprites.animation.setState('idle_right');
    }
    if (glov_input.keyDown(KEYS.UP) || glov_input.keyDown(KEYS.W) ||
      glov_input.padButtonDown(pad_codes.UP)
    ) {
      test.character.dy = -1;
    } else if (glov_input.keyDown(KEYS.DOWN) || glov_input.keyDown(KEYS.S) ||
      glov_input.padButtonDown(pad_codes.DOWN)
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
    if (glov_input.mouseDown() && glov_input.mouseOver(bounds)) {
      v4copy(test.color_sprite, color_yellow);
    } else if (glov_input.click(bounds)) {
      v4copy(test.color_sprite, (test.color_sprite[2] === 0) ? color_white : color_red);
      sound_manager.play('test');
    } else if (glov_input.mouseOver(bounds)) {
      v4copy(test.color_sprite, color_white);
      test.color_sprite[3] = 0.5;
    } else {
      v4copy(test.color_sprite, color_white);
      test.color_sprite[3] = 1;
    }

    sprites.game_bg.draw({
      x: 0, y: 0, z: Z.BACKGROUND,
      color: [0, 0.72, 1, 1]
    });
    sprites.test_tint.drawDualTint({
      x: test.character.x,
      y: test.character.y,
      z: Z.SPRITES,
      color: [1, 1, 0, 1],
      color1: [1, 0, 1, 1],
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
          [100 + Math.random() * 120, 100 + Math.random() * 140, Z.PARTICLES]
        );
      }
    }

    if (flagGet('perf_test')) {
      perfTestSprites();
    }

    // Debugging touch state on mobile
    // const glov_camera2d = require('./glov/camera2d.js');
    // glov_engine.font.drawSizedWrapped(glov_engine.fps_style, glov_camera2d.x0(), glov_camera2d.y0(), Z.FPSMETER,
    //   glov_camera2d.w(), 0, 22, JSON.stringify({
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