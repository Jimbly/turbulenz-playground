#pragma WebGL2

precision lowp float;

uniform sampler2D tex0;
uniform sampler2D tex1;

uniform vec4 hex_param;

varying lowp vec4 interp_color;
varying vec2 interp_texcoord;

//const float SKEW_X = sqrt(0.5*0.5 + 1.0);
const float HEX_HEIGHT = 1.0;
const vec2 VIEW_OFFS = vec2(0.5, 0.0);
const float HEX_EDGE = HEX_HEIGHT / sqrt(3.0);
const float HEX_EXTRA_WIDTH = 0.5 * HEX_EDGE; // cos(60/180*PI) * HEX_EDGE
const float HEX_WIDTH = HEX_EDGE + HEX_EXTRA_WIDTH; // 1.5 * HEX_EDGE
const float HEX_NON_EXTRA = HEX_EDGE / HEX_WIDTH; // 2/3rds
const float HEX_HEIGHT_2 = HEX_HEIGHT / 2.0; // sin(60/180*PI) (0.85) * HEX_EDGE
const float HEX_SLOPE = HEX_HEIGHT_2 / HEX_EXTRA_WIDTH;

// Returns distance to the line from point p0
// dir is a normalized direction
float pointLineDist(vec2 p1, vec2 dir, vec2 p0) {
  vec2 b = p1 - p0;
  return abs(dir.x * b.y - dir.y * b.x);
}


void main(void) {
  vec2 fpos = (interp_texcoord - VIEW_OFFS) * vec2(1.0 / HEX_WIDTH, 1.0 / HEX_HEIGHT);
  float ix = floor(fpos.x);
  bool odd = ix - 2.0 * floor(ix/2.0) == 1.0;
  if (odd) {
    fpos.y -= 0.5;
  }
  float fracx = fpos.x - ix;
  float iy = floor(fpos.y);
  float fracy = fpos.y - iy;
  if (fracx < HEX_NON_EXTRA) {
    // in solid section
  } else {
    // in overlapping section
    float run = ((fracx - HEX_NON_EXTRA) * HEX_WIDTH);
    if (fracy > 0.5) {
      // in top half
      float slope = (1.0 - fracy) * HEX_HEIGHT / run;
      if (slope < HEX_SLOPE) {
        // in next over and up
        ix++;
        if (odd) {
          iy++;
        }
        fracy -= 0.5;
        fracx -= 1.0;
      }
    } else {
      // in bottom half
      float slope = (fracy * HEX_HEIGHT) / run;
      if (slope < HEX_SLOPE) {
        // in next over and down
        ix++;
        if (!odd) {
          iy--;
        }
        fracy += 0.5;
        fracx -= 1.0;
      }
    }
  }

  // integer hex coordinates
  vec2 texcoords = vec2(ix, iy);
  // texcoords = vec2(floor(interp_texcoord / HEX_HEIGHT));

  texcoords = (texcoords + 0.5) / hex_param.x;

  vec4 tex = texture2D(tex0, texcoords);
  vec4 tex_color = texture2D(tex1, texcoords);
  float alpha = interp_color.a;
  float mode = hex_param.y;
  vec3 color = tex_color.rgb;
  if (mode == 3.0) {
    // rivers
    vec4 bits1;
    vec3 bits2;
    float bits_source = tex.x * 255.0;
    bits1.x = bits_source * 0.5 + 0.1;
    bits1.y = floor(bits1.x) * 0.5 + 0.1;
    bits1.z = floor(bits1.y) * 0.5 + 0.1;
    bits1.w = floor(bits1.z) * 0.5 + 0.1;
    bits2.x = floor(bits1.w) * 0.5 + 0.1;
    bits2.y = floor(bits2.x) * 0.5 + 0.1;
    bits2.z = floor(bits2.y) * 0.25 + 0.1;
    bits1 = floor(fract(bits1) * 2.0);
    bits2 = floor(fract(bits2) * vec3(2.0, 2.0, 4.0));

    float strahler = tex.y * 255.0;

    fracx = fracx * 0.75 + 0.25;
    float r = 0.0;
    vec2 pt = vec2(fracx, fracy);
    float dist = pointLineDist(vec2(0.5, 0.0), vec2(0.0, 1.0), pt);
    float RHWIDTH = min(strahler * 0.04, 0.24);
    if (dist < RHWIDTH) {
      r += dot(bits1.wx, vec2(fracy < 0.5 ? 1.0 : 0.0, fracy < 0.5 ? 0.0 : 1.0));
    }
    dist = pointLineDist(vec2(-0.25, 0.0), vec2(0.83205, 0.5547), pt);
    if (dist < RHWIDTH) {
      r += dot(vec2(bits2.x, bits1.y), vec2(fracx < 0.5 ? 1.0 : 0.0, fracx < 0.5 ? 0.0 : 1.0));
    }
    dist = pointLineDist(vec2(1.25, 0.0), vec2(-0.83205, 0.5547), pt);
    if (dist < RHWIDTH) {
      r += dot(vec2(bits2.y, bits1.z), vec2(fracx < 0.5 ? 1.0 : 0.0, fracx < 0.5 ? 0.0 : 1.0));
    }
    dist = distance(pt, vec2(0.5, 0.5));
    if (dist < RHWIDTH*1.1 && bits_source > 0.0) {
      r++;
    }

    if (r > 0.01) {
      color.rgb = vec3(0.0, 0.0, strahler * 48.0);
    }
  }
  if (ix < 0.0 || ix >= hex_param.x || iy < 0.0 || iy >= hex_param.x) {
    alpha = 0.0;
  }
  gl_FragColor = vec4(color * interp_color.rgb, alpha);
}
