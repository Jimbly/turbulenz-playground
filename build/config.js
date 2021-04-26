module.exports = {
  server_js_files: ['**/*.js', '!client/**/*.js'],
  server_static: ['**/common/words/*.gkg'],
  all_js_files: ['**/*.js', '!client/vendor/**/*.js'],
  client_js_files: [
    '**/*.js',
    '!server/**/*.js',
    '!client/vendor/**/*.js',
  ],
  client_json_files: ['client/**/*.json', 'client/**/*.json5', '!client/vendor/**/*.json'],
  server_json_files: ['server/**/*.json', 'server/**/*.json5'],
  client_html: ['client/**/*.html'],
  client_html_index: ['**/client/index.html'],
  client_css: ['client/**/*.css', '!client/sounds/Bfxr/**'],
  client_static: [
    'client/**/*.webm',
    'client/**/*.mp3',
    'client/**/*.wav',
    'client/**/*.ogg',
    'client/**/*.png',
    'client/**/*.jpg',
    'client/**/*.glb',
    'client/**/*.ico',
    '!**/unused/**',
    '!client/sounds/Bfxr/**',
    // 'client/**/vendor/**',
    // 'client/manifest.json',
  ],
  client_vendor: ['client/**/vendor/**'],
  compress_files: [
    'client/**/*.js',
    'client/**/*.html',
    'client/**/*.css',
    'client/**/*.glb',
    'client/**/manifest.json',
  ],
  client_fsdata: [
    'client/shaders/**',
    'client/glov/shaders/**',
    'client/glov/models/box_textured_embed.glb',
    'client/glov/words/*.txt',
    'common/words/*.gkg',
  ],
  default_defines: {
    FACEBOOK: false,
    ENV: 'default',
  },
  extra_index: [],
  bundles: [{
    entrypoint: 'app',
    deps: 'app_deps',
    is_worker: false,
    do_version: 'client/app.ver.json',
  }],
  extra_client_tasks: [],
  extra_prod_inputs: [], // Will bypass the production zip bundling, but still get in the raw production output
  client_intermediate_input: [
    'client_json:**',
    'client_js_uglify:**',
  ],
  client_register_cbs: [],
};
require('./config.project.js')(module.exports);
