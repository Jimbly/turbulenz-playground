const { min } = Math;

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

export function getBiomeV1(is_land, elev, humidity, choice) {
  if (!is_land) {
    return OCEAN;
  } else if (elev > 0.6667) {
    if (humidity > 0.75) {
      return TUNDRA;
    } else {
      return MOUNTAINS;
    }
  } else if (elev > 0.3333) {
    if (humidity > 0.75) {
      return MOUNTAINS;
    } else if (humidity > 0.5) {
      return HILLS_FOREST;
    } else if (humidity > 0.25) {
      return HILLS;
    } else {
      return PLAINS;
    }
  } else {
    if (humidity > 0.75) {
      return weightedChoiceGet(choice_elev0_hum75, choice);
    } else if (humidity > 0.5) {
      return weightedChoiceGet(choice_elev0_hum50, choice);
    } else if (humidity > 0.25) {
      return weightedChoiceGet(choice_elev0_hum25, choice);
    } else {
      return DESERT;
    }
  }
}

export function getBiomeV2(is_land, tot_slope, elev, humidity, choice, cdist) {
  if (!is_land) {
    return OCEAN;
  }
  tot_slope *= 4;
  elev *= 4;
  let is_cliff = tot_slope > 0.6;
  if (is_cliff) {
    return CLIFFS;
  }
  let mountain_cutoff = (0.30 + min(cdist / 0.1, 1) * 0.15);
  if (elev > mountain_cutoff) {
    if (tot_slope > 0.1) {
      return MOUNTAINS;
    } else {
      return TUNDRA;
    }
  }
  if (elev > mountain_cutoff / 2) {
    if (humidity > 0.75) {
      return MOUNTAINS;
    } else if (humidity > 0.5) {
      return HILLS_FOREST;
    } else if (humidity > 0.25) {
      return HILLS;
    } else {
      return PLAINS;
    }
  } else {
    if (humidity > 0.75) {
      return weightedChoiceGet(choice_elev0_hum75, choice);
    } else if (humidity > 0.5) {
      return weightedChoiceGet(choice_elev0_hum50, choice);
    } else if (humidity > 0.25) {
      return weightedChoiceGet(choice_elev0_hum25, choice);
    } else {
      return DESERT;
    }
  }
}
