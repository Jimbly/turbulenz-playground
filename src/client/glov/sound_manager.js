/*global WebGLSoundDevice: true */

const DEFAULT_FADE_RATE = 0.001;

let sounds = {};
let num_loading = 0;
class SoundManager {
  constructor(listenerTransform) {
    if (!listenerTransform) {
      // const camera = Camera.create(VMath);
      // const look_at_position = VMath.v3Build(0, 1, 0);
      // const worldUp = VMath.v3Build(0, 0, 1);
      // const camera_position = VMath.v3Build(0, 0, 0);
      // camera.lookAt(look_at_position, worldUp, camera_position);
      // camera.updateViewMatrix();
      // listenerTransform = camera.matrix;
      listenerTransform = new Float32Array([1, 0, -0, 0, 0, 1, 0, -1, 0, 0, 0, 0]);
    }
    let soundDeviceParameters = {
      linearDistance: false
    };
    this.soundDevice = WebGLSoundDevice.create(soundDeviceParameters);
    this.soundDevice.listenerTransform = listenerTransform;
    this.auto_oggs = false; // try loading .ogg versions first, then fallback to .wav
    this.auto_mp3s = false; // try loading .mp3 versions first, then fallback to .wav
    this.sound_on = true;
    this.music_on = true;

    this.channels = [];
    for (let ii = 0; ii < 16; ++ii) {
      this.channels[ii] = this.soundDevice.createSource({
        position: [0, 0, 0],
        relative: false,
        pitch: 1.0,
      });
    }
    this.channel = 0;
    this.last_played = {};
    this.global_timer = 0;

    // Music
    this.fade_rate = DEFAULT_FADE_RATE;
    this.current_loop = null;
    this.music = []; // 0 is current, 1 is previous (fading out)
    for (let ii = 0; ii < 2; ++ii) {
      this.music.push({
        source: this.soundDevice.createSource({
          position: [0, 0, 0],
          relative: false,
          pitch: 1.0,
          looping: true,
        }),
        current_volume: 0,
        target_volume: 0,
      });
    }
  }

  loadSound(base, cb) {
    if (Array.isArray(base)) {
      for (let ii = 0; ii < base.length; ++ii) {
        this.loadSound(base[ii], cb);
      }
      return;
    }
    let key = base;
    let m = base.match(/^(.*)\.(mp3|ogg|wav)$/u);
    let preferred_ext;
    if (m) {
      base = m[1];
      preferred_ext = m[2];
    }
    let src = `sounds/${base}`;
    let tryLoad = (ext) => {
      ++num_loading;
      this.soundDevice.createSound({
        src: src + ext,
        onload: function (sound) {
          --num_loading;
          if (sound) {
            sounds[key] = sound;
            if (cb) {
              return cb();
            }
          } else {
            // failed to load
            if (ext === '.ogg' || ext === '.mp3') {
              tryLoad('.wav');
            }
          }
          return null;
        }
      });
    };
    if (this.soundDevice.isSupported('FILEFORMAT_OGG') && (this.auto_oggs || preferred_ext === 'ogg')) {
      tryLoad('.ogg');
    } else if (this.soundDevice.isSupported('FILEFORMAT_MP3') && (this.auto_mp3s || preferred_ext === 'mp3')) {
      tryLoad('.mp3');
    } else {
      tryLoad('.wav');
    }
  }

  tick(dt) {
    this.global_timer += dt;
    let max_fade = dt * this.fade_rate;
    for (let ii = 0; ii < this.music.length; ++ii) {
      let target = this.music_on ? this.music[ii].target_volume : 0;
      if (this.music[ii].current_volume !== target) {
        let delta = target - this.music[ii].current_volume;
        let fade_amt = Math.min(Math.abs(delta), max_fade);
        if (delta < 0) {
          this.music[ii].current_volume = Math.max(target, this.music[ii].current_volume - fade_amt);
        } else {
          this.music[ii].current_volume = Math.min(target, this.music[ii].current_volume + fade_amt);
        }
        this.music[ii].source.gain = this.music[ii].current_volume;
      }
    }
  }

  resume() {
    this.soundDevice.resume();
  }

  play(soundname, volume) {
    volume = volume || 1;
    if (!this.sound_on) {
      return null;
    }
    if (!sounds[soundname]) {
      return null;
    }
    let last_played_time = this.last_played[soundname] || -9e9;
    if (this.global_timer - last_played_time < 45) {
      return null;
    }
    let channel = this.channels[this.channel++];
    channel.play(sounds[soundname]);
    channel.gain = volume;
    this.last_played[soundname] = this.global_timer;
    if (this.channel === this.channels.length) {
      this.channel = 0;
    }
    return {
      stop: function () {
        channel.stop();
      }
    };
  }

  playMusic(soundname, volume, transition) {
    if (!this.music_on) {
      return;
    }
    if (volume === undefined) {
      volume = 1;
    }
    transition = transition || SoundManager.DEFAULT;
    this.loadSound(soundname, () => {
      if (!sounds[soundname]) {
        return;
      }
      if (this.current_loop === soundname) {
        // Same sound, just adjust volume, if required
        this.music[0].target_volume = volume;
        if (!transition) {
          this.music[0].source.gain = this.music[0].current_volume = volume;
        }
        return;
      }
      // fade out previous music, if any
      /* eslint-disable no-bitwise */
      if (this.music[0].current_volume) {
        if (transition & SoundManager.FADE_OUT) {
          // swap to position 1, start fadeout
          let temp = this.music[1];
          this.music[1] = this.music[0];
          this.music[0] = temp;
          this.music[1].target_volume = 0;
        }
        // else source will be replaced, just let it be!
      }
      this.current_loop = soundname;
      this.music[0].target_volume = volume;
      if (transition & SoundManager.FADE_IN) {
        this.music[0].source.gain = this.music[0].current_volume = 0;
      } else {
        this.music[0].source.gain = this.music[0].current_volume = volume;
      }
      this.music[0].source.play(sounds[soundname], 0, true);
      /* eslint-enable no-bitwise */
    });
  }

  loading() { // eslint-disable-line class-methods-use-this
    return num_loading;
  }

}

SoundManager.DEFAULT = SoundManager.prototype.DEFAULT = 0;
SoundManager.FADE_OUT = SoundManager.prototype.FADE_OUT = 1;
SoundManager.FADE_IN = SoundManager.prototype.FADE_IN = 2;
SoundManager.FADE = SoundManager.prototype.FADE = SoundManager.prototype.FADE_OUT + SoundManager.prototype.FADE_IN;


export function create(listenerTransform) {
  return new SoundManager(listenerTransform);
}
