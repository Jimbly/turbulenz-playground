function GlovSpriteAnimation(params) {
  this.frame = 0;
  this.time = 0;
  this.state = null;
  this.anim = null;
  this.anim_idx = 0;

  if (params instanceof GlovSpriteAnimation) {
    this.data = params.data; // already initialized
    this.setState(params.state);
  } else {
    this.data = params;
    for (let key in this.data) {
      let anim = this.data[key];
      if (typeof anim.frames === 'number') {
        anim.frames = [anim.frames];
      }
      if (typeof anim.times === 'number') {
        let arr = new Array(anim.frames.length);
        for (let ii = 0; ii < anim.frames.length; ++ii) {
          arr[ii] = anim.times;
        }
        anim.times = arr;
      }
      if (anim.loop === undefined) {
        anim.loop = true;
      }
    }
  }
}

export function create(params) {
  return new GlovSpriteAnimation(params);
}

GlovSpriteAnimation.prototype.clone = function () {
  return new GlovSpriteAnimation(this);
};

GlovSpriteAnimation.prototype.setState = function (state, force) {
  if (state === this.state && !force) {
    return;
  }
  this.state = state;
  this.anim = this.data[state];
  this.time = 0;
  this.anim_idx = 0;
  this.frame = this.anim.frames[this.anim_idx];
};

GlovSpriteAnimation.prototype.update = function (dt) {
  if (!this.anim) {
    return;
  }
  this.time += dt;
  if (this.time > this.anim.times[this.anim_idx]) {
    this.time -= this.anim.times[this.anim_idx];
    this.anim_idx = this.anim_idx + 1;
    if (this.anim_idx === this.anim.frames.length) {
      if (this.anim.loop) {
        this.anim_idx = this.anim_idx % this.anim.frames.length;
      } else {
        // keep final frame
        this.anim = null;
        return;
      }
    }
    this.frame = this.anim.frames[this.anim_idx];
    if (this.time >= this.anim.times[this.anim_idx]) {
      this.time = this.anim.times[this.anim_idx] - 1;
    }
  }
};

GlovSpriteAnimation.prototype.getFrame = function (dt) {
  if (dt !== undefined) {
    this.update(dt);
  }
  return this.frame;
};
