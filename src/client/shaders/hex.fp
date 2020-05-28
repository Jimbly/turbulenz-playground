#pragma WebGL2

precision lowp float;

uniform sampler2D tex0;

uniform vec4 hex_param;

varying lowp vec4 interp_color;
varying vec2 interp_texcoord;

const float SKEW_X = sqrt(0.5*0.5 + 1.0);
const float HEX_HEIGHT = 1.0;
const vec2 VIEW_OFFS = vec2(HEX_HEIGHT, 0.0);
const float HEX_EDGE = HEX_HEIGHT / sqrt(3.0);
const float HEX_EXTRA_WIDTH = 0.5 * HEX_EDGE; // cos(60/180*PI) * HEX_EDGE
const float HEX_WIDTH = HEX_EDGE + HEX_EXTRA_WIDTH; // 1.5 * HEX_EDGE
const float HEX_NON_EXTRA = HEX_EDGE / HEX_WIDTH; // 2/3rds
const float HEX_HEIGHT_2 = HEX_HEIGHT / 2.0; // sin(60/180*PI) (0.85) * HEX_EDGE
const float HEX_SLOPE = HEX_HEIGHT_2 / HEX_EXTRA_WIDTH;

void main(void) {
    vec2 fpos = (interp_texcoord - VIEW_OFFS) * vec2(1.0 / HEX_WIDTH, 1.0 / HEX_HEIGHT);
    float ix = floor(fpos.x);
    bool odd = ix - 2.0 * floor(ix/2.0) == 1.0;
    if (odd) {
      fpos.y -= 0.5;
    }
    float fracx = fpos.x - ix;
    float iy = floor(fpos.y);
    if (fracx < HEX_NON_EXTRA) {
      // in solid section
    } else {
      // in overlapping section
      float run = ((fracx - HEX_NON_EXTRA) * HEX_WIDTH);
      float fracy = fpos.y - iy;
      if (fracy > 0.5) {
        // in top half
        float slope = (1.0 - fracy) * HEX_HEIGHT / run;
        if (slope < HEX_SLOPE) {
          // in next over and up
          ix++;
          if (odd) {
            iy++;
          }
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
        }
      }
    }


  // integer hex coordinates
  vec2 texcoords = vec2(ix, iy);
  // texcoords = vec2(floor(interp_texcoord / HEX_HEIGHT));

  texcoords = (texcoords + 0.5) / hex_param.x;

  vec4 tex = texture2D(tex0, texcoords);
  vec3 color = vec3(1.0, 0.0, 1.0);
  float alpha = interp_color.a;
  int debug = int(tex.y * 255.0 + 0.1);
  float land = tex.x;
  float mode = hex_param.y;
  if (mode == 0.0) {
    // coast
    color = vec3(land);
    if (debug == 3) {
      // inland sea
      color.g = 0.25;
      color.b = 1.0;
    } else if (debug == 2) {
      // border
      color.r = 1.0;
      color.b = 0.5;
    } else if (debug == 1) {
      // ocean
      color.rgb = vec3(0.0, 0.0, 1.0);
    }
  } else if (mode == 1.0) {
    // terrain slope
    color = vec3(tex.z);
    if (land == 0.0) {
      color = vec3(0.0, 0.0, 1.0);
    }
  } else if (mode == 2.0) {
    // river slope
    color = vec3(tex.w);
    if (land == 0.0) {
      color = vec3(0.0, 0.0, 1.0);
    }
  }
  if (ix < 0.0 || ix >= hex_param.x || iy < 0.0 || iy >= hex_param.x) {
    alpha = 0.0;
  }
  gl_FragColor = vec4(color * interp_color.rgb, alpha);
}
