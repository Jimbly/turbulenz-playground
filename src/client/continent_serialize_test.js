// Additional serialization methods and comparison, that were not significantly
//   better.

const assert = require('assert');
const { packetCreate } = require('../common/packet.js');
const { ridx } = require('../common/util.js');
const {
  encodeRLEZeroes,
  encodeRLEU2,
  encodeRLEDict,
  encodeDeltaPakInt,
} = require('./continent_serialize.js');

function BitBuffer() {
  this.pak = packetCreate(0);
  this.v = 0;
  this.b = 0;
}
BitBuffer.prototype.writeBits = function (num_bits, value) {
  assert(num_bits < 24);
  let { v, b, pak } = this;
  v |= value << b;
  b += num_bits;
  while (b > 8) {
    pak.writeU8(v & 255);
    v >>>= 8;
    b -= 8;
  }
  this.v = v;
  this.b = b;
};
BitBuffer.prototype.flush = function () {
  let { pak, b } = this;
  if (b) {
    this.writeBits(8 - b, 0);
  }
  pak.makeReadable();
  let ret_len = pak.getBufferLen();
  let ret = pak.getBuffer().slice(0, ret_len);
  pak.pool();
  return ret;
};

function encodeRLEPakInt(pak, data) {
  let v = data[0];
  let size = data.length;
  let c = 0;
  for (let ii = 1; ii < size; ++ii) {
    if (data[ii] !== v) {
      pak.writeInt(c);
      pak.writeInt(v);
      c = 0;
      v = data[ii];
    } else {
      c++;
    }
  }
  pak.writeInt(c);
  pak.writeInt(v);
}

function encodeRLEUx(base_bits, data) {
  let count_pak = packetCreate(0);
  let value_buf = new BitBuffer();
  let v = data[0];
  let size = data.length;
  let c = 0;
  function writecv() {
    count_pak.writeInt(c);
    if (v) {
      value_buf.writeBits(1, 1);
      value_buf.writeBits(base_bits, v);
    } else {
      value_buf.writeBits(1, 0);
    }
  }
  for (let ii = 1; ii < size; ++ii) {
    if (data[ii] !== v) {
      writecv();
      c = 0;
      v = data[ii];
    } else {
      c++;
    }
  }
  writecv();

  count_pak.makeReadable();
  let ret_len = count_pak.getBufferLen();
  let ret1 = count_pak.getBuffer().slice(0, ret_len);
  count_pak.pool();
  let ret2 = value_buf.flush();
  return [ret1, ret2];
}

let temp_u8_encode;
function encodeRLEU8(data) {
  if (!(data instanceof Uint8Array)) {
    return '';
  }
  if (!temp_u8_encode || temp_u8_encode.length < data.length * 2) {
    temp_u8_encode = new Uint8Array(data.length * 2);
  }
  let out = temp_u8_encode;
  let idx = 0;

  let v = data[0];
  let size = data.length;
  let c = 0;
  for (let ii = 1; ii < size; ++ii) {
    if (data[ii] !== v || c === 255) {
      out[idx++] = c;
      out[idx++] = v;
      c = 0;
      v = data[ii];
    } else {
      c++;
    }
  }
  out[idx++] = c;
  out[idx++] = v;
  return out.slice(0, idx);
}

let temp_u16_encode;
function encodeRLEU16(data) {
  if (!(data instanceof Uint16Array)) {
    return '';
  }
  if (!temp_u16_encode || temp_u16_encode.length < data.length * 2) {
    temp_u16_encode = new Uint16Array(data.length * 2);
  }
  let out = temp_u16_encode;
  let idx = 0;

  let v = data[0];
  let size = data.length;
  let c = 0;
  for (let ii = 1; ii < size; ++ii) {
    if (data[ii] !== v || c === 65535) {
      out[idx++] = c;
      out[idx++] = v;
      c = 0;
      v = data[ii];
    } else {
      c++;
    }
  }
  out[idx++] = c;
  out[idx++] = v;
  return out.slice(0, idx);
}

function encodeHuffman(data) {
  // Build encoding table
  let histo = {};
  for (let ii = 0; ii < data.length; ++ii) {
    let v = data[ii];
    histo[v] = (histo[v] || 0) + 1;
  }
  let nodes = [];
  for (let key in histo) {
    let v = Number(key);
    let count = histo[key];
    nodes.push([count, v]);
  }
  function checkCount() {
    let a = 0;
    for (let ii = 0; ii < nodes.length; ++ii) {
      a += nodes[ii][0];
    }
    assert.equal(a, data.length);
  }
  checkCount();
  while (nodes.length > 1) {
    let lowest1 = 0;
    let lowest2 = 1;
    if (nodes[0][0] > nodes[1][0]) {
      lowest1 = 1;
      lowest2 = 0;
    }
    for (let ii = 2; ii < nodes.length; ++ii) {
      if (nodes[ii][0] < nodes[lowest2][0]) {
        if (nodes[ii][0] < nodes[lowest1][0]) {
          lowest2 = lowest1;
          lowest1 = ii;
        } else {
          lowest2 = ii;
        }
      }
    }
    assert(lowest1 !== lowest2);
    let n1 = nodes[lowest1];
    let n2 = nodes[lowest2];
    let newnode = [n1[0] + n2[0], [n1[1], n2[1]]];
    if (lowest1 === nodes.length - 1) {
      nodes.pop();
      ridx(nodes, lowest2);
    } else if (lowest2 === nodes.length - 1) {
      nodes.pop();
      ridx(nodes, lowest1);
    } else {
      ridx(nodes, lowest1);
      ridx(nodes, lowest2);
    }
    nodes.push(newnode);
    checkCount();
  }
  let encoding = [];
  // Note: current data written to enc_pak is not coherent, we'd need to first
  // sort nodes by their values so a values lower than the current node_idx
  // is never written
  let enc_pak = packetCreate(0);
  let node_idx = 0;
  function walk(node, prefix, numbits) {
    if (Array.isArray(node)) {
      prefix <<= 1;
      let left_idx = walk(node[0], prefix, numbits+1);
      let right_idx = walk(node[1], prefix | 1, numbits+1);
      enc_pak.writeInt(left_idx);
      enc_pak.writeInt(right_idx);
    } else {
      encoding[node] = [prefix, numbits];
      enc_pak.writeInt(node);
    }
    return node_idx++;
  }
  walk(nodes[0][1], 0, 0);

  let buf = new BitBuffer();

  for (let ii = 0; ii < data.length; ++ii) {
    let v = data[ii];
    let enc = encoding[v];
    assert(enc);
    buf.writeBits(enc[1], enc[0]);
  }

  enc_pak.makeReadable();
  let ret_len = enc_pak.getBufferLen();
  let ret1 = enc_pak.getBuffer().slice(0, ret_len);
  enc_pak.pool();
  return [buf.flush(), ret1];
}

function encodeWrap(fn) {
  return function (data) {
    let pak = packetCreate(0);
    fn(pak, data);
    pak.makeReadable();
    let ret_len = pak.getBufferLen();
    let ret = pak.getBuffer().slice(0, ret_len);
    pak.pool();
    return ret;
  };
}

export function continentSerializeTest(cdata) {
  [
    'elev',        // U16
    'water_level', // U16
    'humidity',    // U8
    'river',       // U8
    'classif',     // U8
  ].forEach(function (field) {
    let data = cdata[field];
    console.log(`${field}:`);
    function test(name, fn) {
      let buf = fn(data);
      if (Array.isArray(buf)) {
        let b0 = buf[0].buffer.byteLength;
        let b1 = buf[1].buffer.byteLength;
        console.log(`  ${name}: ${b0 + b1} (${b0} + ${b1})`);
      } else {
        console.log(`  ${name}: ${buf.buffer.byteLength}`);
      }
    }
    test('raw', () => new Uint8Array(data.buffer));
    test('RLEPakInt', encodeWrap(encodeRLEPakInt));
    test('RLEZeroes', encodeWrap(encodeRLEZeroes));
    test('RLEDict', encodeWrap(encodeRLEDict));
    test('RLEU8/16', (data instanceof Uint8Array) ? encodeRLEU8 : encodeRLEU16);
    test('DeltaPakInt', encodeWrap(encodeDeltaPakInt));
    if (field === 'river') {
      test('RLEU6', encodeRLEUx.bind(null, 6));
    }
    if (field === 'classif') {
      test('RLEUx(2)', encodeRLEUx.bind(null, 2));
      test('RLEU2', encodeWrap(encodeRLEU2));
    }
    test('Huffman', encodeHuffman);
    test('Huffman(DeltaPakInt)',() => encodeHuffman(encodeWrap(encodeDeltaPakInt)(data)));

    // Chaining did nothing good:
    // test('rlePakInt(deltaPakInt)', () => encodeWrap(encodePakInt)(encodeWrap(encodeDeltaPakInt)(data)));
    // test('encodeRLEDict(deltaPakInt)', () => encodeWrap(encodeRLEDict)(encodeWrap(encodeDeltaPakInt)(data)));
  });
}
