const { sqrt } = Math;

export const SKEW_X = 1 / (sqrt(1 - 0.5*0.5)); // 1.1547

// biome type classification categories from continent generation
export const C_WATER = 0;
export const C_PLAINS = 1;
export const C_HILLS = 2;
export const C_MOUNTAINS = 3;
