/* eslint no-extend-native:off */

// TypedArray.slice - not supported on IE, some older Safari
if (!Uint8Array.prototype.slice) {
  Object.defineProperty(Uint8Array.prototype, 'slice', {
    value: function (begin, end) {
      // PERFTODO: If we use this on any significant audience, this can be likely
      // way faster by not making a temporary Array in the middle
      return new Uint8Array(Array.prototype.slice.call(this, begin, end));
    }
  });
  Object.defineProperty(Float32Array.prototype, 'slice', {
    value: function (begin, end) {
      // PERFTODO: If we use this on any significant audience, this can be likely
      // way faster by not making a temporary Array in the middle
      return new Float32Array(Array.prototype.slice.call(this, begin, end));
    }
  });
}
