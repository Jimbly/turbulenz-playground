const assert = require('assert');
const { abs } = Math;
const { randCreate } = require('./glov/rand_alea.js');

const C_WATER = 0;
const C_PLAINS = 1;
const C_HILLS = 2;
const C_MOUNTAINS = 3;

function rgb(r,g,b) {
  return new Uint8Array([r, g, b, 255]);
}
const OCEAN = rgb(0, 0, 255);
const TUNDRA = rgb(224,244,255);
const MOUNTAINS = rgb(170,170,170);
const CLIFFS = rgb(90,90,90);
const HILLS_FOREST = rgb(32,128,32);
const DENSE_FOREST = rgb(16,64,16);
const PLAINS_FOREST = rgb(96,128,32);
const HILLS = rgb(64,255,64);
const PLAINS = rgb(255,255,64);
const DESERT = rgb(255,255,191);
const PLAINS_RED = rgb(255,96,64);
const PLAINS_BLUE = rgb(64,96,255);

const COMMON = 1;
const UNCOMMON = 0.25;
const RARE = 0.03;
function weightedChoiceBuild(list) {
  let total = 0;
  for (let ii = 0; ii < list.length; ++ii) {
    total += list[ii][0];
  }
  return { total, list };
}

function weightedChoiceGet(precalc, choice) {
  let { total, list } = precalc;
  let w = total * choice;
  for (let ii = 0; ii < list.length; ++ii) {
    w -= list[ii][0];
    if (w <= 0) {
      return list[ii][1];
    }
  }
  // Should never get here, baring floating point rounding errors
  return list[0][1];
}

const choice_elev0_hum75 = weightedChoiceBuild([
  [COMMON, DENSE_FOREST],
  [UNCOMMON, PLAINS_FOREST],
]);

const choice_elev0_hum50 = weightedChoiceBuild([
  [COMMON, PLAINS_FOREST],
  [UNCOMMON, PLAINS],
]);

const choice_elev0_hum25 = weightedChoiceBuild([
  [COMMON, PLAINS],
  [RARE, PLAINS_BLUE],
  [RARE, PLAINS_RED],
  [RARE, HILLS],
]);

function getBiomeV2(classif, tot_slope, elev, humidity, choice, cdist) {
  if (classif === C_WATER) {
    return OCEAN;
  }
  tot_slope *= 4;
  let is_cliff = tot_slope > 0.6;
  if (is_cliff) {
    return CLIFFS;
  }
  if (classif === C_MOUNTAINS) {
    if (tot_slope > 0.1) {
      return MOUNTAINS;
    } else {
      return TUNDRA;
    }
  }
  if (classif === C_HILLS) {
    if (humidity > 0.66) {
      return HILLS_FOREST;
    } else {
      return HILLS;
    }
  } else if (classif === C_PLAINS) {
    if (humidity > 0.75) {
      return weightedChoiceGet(choice_elev0_hum75, choice);
    } else if (humidity > 0.5) {
      return weightedChoiceGet(choice_elev0_hum50, choice);
    } else if (humidity > 0.25) {
      return weightedChoiceGet(choice_elev0_hum25, choice);
    } else {
      return DESERT;
    }
  } else {
    return assert(0);
  }
}

export function calculateBiomesTest(hex_tex_size, cdata, tex_data_color) {
  let {
    elev, humidity, classif, ocean_distance, sea_level, max_elevation,
  } = cdata;
  // This is not in output, just simulating what the game will do with this data when it gets it
  let width = hex_tex_size;
  let height = width;
  let stride = width;
  let neighbors_even = [
    stride, // above
    1, // upper right
    1 - stride, // lower right
    -stride, // below
    -1 - stride, // lower left
    -1, // upper left
  ];
  let neighbors_odd = [
    stride, // above
    1 + stride, // upper right,
    1, // lower right
    -stride, // below
    -1, // lower left
    -1 + stride, // upper left,
  ];
  let neighbors_bit = [neighbors_even, neighbors_odd];

  let rand = randCreate(0x12345);

  let land_range = max_elevation - sea_level;
  for (let y = 0; y < height; ++y) {
    for (let x = 0; x < width; ++x) {
      let pos = y * width + x;
      //let is_land = land[pos];
      let celev = (elev[pos] - sea_level) / land_range;
      // let has_river = is_land && river[pos];
      let humid = humidity[pos] / 255;
      // let slope = tslope[pos]; // Use actual calculated abs(max?) of slope from elev?
      let cdist = ocean_distance[pos] / (hex_tex_size * 2);
      let cat = classif[pos];
      let choice = rand.random();

      // calc actual slope
      let tot_slope = 0;
      //let max_slope = 0;
      let neighbors = neighbors_bit[x & 1];
      for (let ii = 0; ii < 6; ++ii) {
        let npos = pos + neighbors[ii];
        let nelev = (elev[npos] - sea_level) / land_range;
        let slope = abs(celev - nelev);
        tot_slope += slope;
        //max_slope = max(max_slope, slope);
      }

      let color = getBiomeV2(cat, tot_slope, celev, humid, choice, cdist);

      //let color = getBiomeV1(is_land, celev, humid, choice);
      for (let jj = 0; jj < 4; ++jj) {
        tex_data_color[pos * 4 + jj] = color[jj];
      }
    }
  }
}
