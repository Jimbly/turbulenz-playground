#pragma WebGL

precision highp float;
precision highp int;

varying vec2 interp_texcoord;

vec4 _ret_0;
vec4 _TMP2;
vec4 _TMP1;
vec2 _c0022;
vec2 _c0024;
uniform vec2 sampleRadius;
uniform sampler2D inputTexture0;
uniform float Gauss[9];

void main()
{
  vec2 uv = interp_texcoord;
  vec2 step = sampleRadius;
  gl_FragColor =
    ((texture2D(inputTexture0, uv - step * 3.0) + texture2D(inputTexture0, uv + step * 3.0)) * 0.085625 +
    (texture2D(inputTexture0, uv - step * 2.0) + texture2D(inputTexture0, uv + step * 2.0)) * 0.12375 +
    (texture2D(inputTexture0, uv - step * 1.0) + texture2D(inputTexture0, uv + step * 1.0)) * 0.234375 +
    texture2D(inputTexture0, uv) * 0.3125) * 0.83333333333333333333333333333333;
}
