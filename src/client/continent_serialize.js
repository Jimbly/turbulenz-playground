const assert = require('assert');
const { packetCreate, packetFromBuffer, PACKET_DEBUG } = require('../common/packet.js');

const CONTINENT_SER_VERSION = 1;

const SER_METHOD_DELTA_PACK_INT = 1;
const SER_METHOD_RLE_DICT = 2;
const SER_METHOD_RLE_ZEROES = 3;
const SER_METHOD_RLE_U2 = 4;

const FIELDS = [
  'elev',        // U16
  'water_level', // U16
  'humidity',    // U8
  'river',       // U8
  'classif',     // U8
];

const SER_METHOD_FOR_FIELD = {
  // U16; best: DeltaPakInt (saves just 19%; will zip
  //            very well after delta encoded, though!)
  // - huffman(delta()) would save another 30%
  elev: SER_METHOD_DELTA_PACK_INT,

  // U16; best: RLEDict (saves 99.6%)
  water_level: SER_METHOD_RLE_DICT,

  // U8;  same: raw=RLEZeroes=DeltaPakInt (saves 0%, but deltas should zip
  //            or huffman very well though)
  // - huffman(delta()) saves a total of 35%
  humidity: SER_METHOD_DELTA_PACK_INT,

  // U8;  best: RLEZeroes (saves 82%)
  river: SER_METHOD_RLE_ZEROES,

  // U8;  best: RLEU2 (saves 92%)
  classif: SER_METHOD_RLE_U2,
};

const FIELD_TYPE = {
  elev: Uint16Array,
  water_level: Uint16Array,
  humidity: Uint8Array,
  river: Uint8Array,
  classif: Uint8Array,
};

// Write either a single value, or a 0 followed by a count of zeroes
export function encodeRLEZeroes(pak, data) {
  let size = data.length;
  let c = 0;
  for (let ii = 0; ii < size; ++ii) {
    let v = data[ii];
    if (v) {
      if (c) {
        pak.writeInt(c);
        c = 0;
      }
      pak.writeInt(v);
    } else {
      if (!c) {
        pak.writeInt(v);
      }
      c++;
    }
  }
  if (c) {
    pak.writeInt(c);
  }
}

function decodeRLEZeroes(data, pak) {
  let idx = 0;
  while (idx < data.length) {
    let v = pak.readInt();
    let c = 1;
    if (!v) {
      c = pak.readInt();
    }
    assert(idx + c <= data.length);
    for (let ii = 0; ii < c; ++ii) {
      data[idx++] = v;
    }
  }
}

export function encodeRLEU2(pak, data) {
  let v = data[0];
  let size = data.length;
  let c = 0;
  function writecv() {
    let out = (v << 6) | c;
    pak.writeU8(out);
  }
  for (let ii = 1; ii < size; ++ii) {
    if (data[ii] !== v || c === 63) {
      writecv();
      c = 0;
      v = data[ii];
    } else {
      c++;
    }
  }
  writecv();
}

function decodeRLEU2(data, pak) {
  let idx = 0;
  while (idx < data.length) {
    let v = pak.readU8();
    let c = (v & 0x3F) + 1;
    v >>>= 6;
    assert(idx + c <= data.length);
    for (let ii = 0; ii < c; ++ii) {
      data[idx++] = v;
    }
  }
}

export function encodeRLEDict(pak, data) {
  let v = data[0];
  let size = data.length;
  let c = 0;
  let dict = [];
  let dict_idx = 0;
  function writecv() {
    pak.writeInt(c);
    let di = dict[v];
    if (di !== undefined) {
      pak.writeInt(di);
    } else {
      di = dict[v] = dict_idx++;
      pak.writeInt(di);
      pak.writeInt(v);
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
}

function decodeRLEDict(data, pak) {
  let idx = 0;
  let dict = [];
  while (idx < data.length) {
    let c = pak.readInt() + 1;
    let di = pak.readInt();
    let v = dict[di];
    if (v === undefined) {
      v = dict[di] = pak.readInt();
    }
    assert(idx + c <= data.length);
    for (let ii = 0; ii < c; ++ii) {
      data[idx++] = v;
    }
  }
}

// Packed int, biasing the delta by 124 to try to keep it in a single byte
//   (which encodes 0-248)
export function encodeDeltaPakInt(pak, data) {
  let v = 124;
  let size = data.length;
  for (let ii = 0; ii < size; ++ii) {
    let delta = data[ii] - v + 124;
    pak.writeInt(delta);
    v = data[ii];
  }
}

function decodeDeltaPakInt(data, pak) {
  let size = data.length;
  let v = 124;
  for (let ii = 0; ii < size; ++ii) {
    v += pak.readInt() - 124;
    data[ii] = v;
  }
}

function encodeToPacket(pak, method, buf) {
  switch (method) {
    case SER_METHOD_DELTA_PACK_INT:
      encodeDeltaPakInt(pak, buf);
      break;
    case SER_METHOD_RLE_DICT:
      encodeRLEDict(pak, buf);
      break;
    case SER_METHOD_RLE_ZEROES:
      encodeRLEZeroes(pak, buf);
      break;
    case SER_METHOD_RLE_U2:
      encodeRLEU2(pak, buf);
      break;
    default:
      assert();
  }
}

function decodeFromPacket(buf, method, pak) {
  switch (method) {
    case SER_METHOD_DELTA_PACK_INT:
      decodeDeltaPakInt(buf, pak);
      break;
    case SER_METHOD_RLE_DICT:
      decodeRLEDict(buf, pak);
      break;
    case SER_METHOD_RLE_ZEROES:
      decodeRLEZeroes(buf, pak);
      break;
    case SER_METHOD_RLE_U2:
      decodeRLEU2(buf, pak);
      break;
    default:
      assert();
  }
}

const FIELD_MAGIC = 227;
export function continentSerialize(cdata, debug) {
  let { sea_level, max_elevation } = cdata;
  let total_size = cdata.elev.length;
  // Estimated total size of packet is = total_size * 3, from empirical data,
  //   give a little extra room.
  let pak = packetCreate(debug ? PACKET_DEBUG : 0, total_size * 4);
  pak.writeFlags();
  pak.writeInt(CONTINENT_SER_VERSION);
  pak.writeInt(sea_level);
  pak.writeInt(max_elevation);
  pak.writeInt(total_size);

  FIELDS.forEach(function (field) {
    pak.writeInt(FIELD_MAGIC);
    encodeToPacket(pak, SER_METHOD_FOR_FIELD[field], cdata[field]);
  });
  pak.makeReadable();
  let ret_len = pak.getBufferLen();
  let ret = pak.getBuffer().slice(0, ret_len);
  pak.pool();
  return ret;
}

export function continentDeserialize(buf) {
  let ret = {};
  let pak = packetFromBuffer(buf, buf.length, false);
  pak.readFlags();
  let ver = pak.readInt();
  assert.equal(ver, CONTINENT_SER_VERSION);
  ret.sea_level = pak.readInt();
  ret.max_elevation = pak.readInt();
  let total_size = pak.readInt();
  assert(total_size <= 512*512);

  FIELDS.forEach(function (field) {
    let field_magic = pak.readInt();
    assert.equal(field_magic, FIELD_MAGIC);
    let ArrayType = FIELD_TYPE[field];
    let out = ret[field] = new ArrayType(total_size);
    decodeFromPacket(out, SER_METHOD_FOR_FIELD[field], pak);
  });
  return ret;
}
