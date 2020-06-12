/* eslint no-invalid-this:off */
const args = require('yargs').argv;
const assert = require('assert');
const babel = require('gulp-babel');
const babelify = require('babelify');
const browserify = require('browserify');
const browser_sync = require('browser-sync');
const clean = require('gulp-clean');
const eslint = require('gulp-eslint');
const fs = require('fs');
const gulp = require('gulp');
const gulpif = require('gulp-if');
const ifdef = require('gulp-ifdef');
const ignore = require('gulp-ignore');
const lazypipe = require('lazypipe');
const log = require('fancy-log');
const useref = require('gulp-useref');
const uglify = require('gulp-uglify');
const newer = require('gulp-newer');
const nodemon = require('gulp-nodemon');
const rename = require('gulp-rename');
const replace = require('gulp-replace');
const sourcemaps = require('gulp-sourcemaps');
const web_compress = require('gulp-web-compress');
const vinyl_buffer = require('vinyl-buffer');
const vinyl_source_stream = require('vinyl-source-stream');
const watchify = require('watchify');
const webfs = require('./gulp/webfs_build.js');
const zip = require('gulp-zip');

//////////////////////////////////////////////////////////////////////////
// Server tasks
const config = {
  server_js_files: ['src/**/*.js', '!src/client/**/*.js'],
  all_js_files: ['src/**/*.js', '!src/client/vendor/**/*.js'],
  client_html: ['src/client/**/*.html'],
  client_html_index: ['src/client/**/index.html'],
  client_css: ['src/client/**/*.css', '!src/client/sounds/Bfxr/**'],
  client_static: [
    'src/client/**/*.webm',
    'src/client/**/*.mp3',
    'src/client/**/*.wav',
    'src/client/**/*.ogg',
    'src/client/**/*.png',
    'src/client/**/*.jpg',
    'src/client/**/*.glb',
    '!**/unused/**',
    '!src/client/sounds/Bfxr/**',
    // 'src/client/**/vendor/**',
    // 'src/client/manifest.json',
  ],
  client_vendor: ['src/client/**/vendor/**'],
  compress_files: [
    'client/**/*.js',
    'client/**/*.html',
    'client/**/*.css',
    'client/**/*.glb',
    'client/**/manifest.json',
  ],
  client_fsdata: [
    'src/client/autogen/**',
    'src/client/shaders/**',
    'src/client/glov/shaders/**',
    '!src/client/autogen/placeholder.txt',
    '!src/client/autogen/*.js',
  ],
};

// At least keep function names to get good callstacks
// const uglify_options = { keep_fnames: true };
// Do no significant minification to make debugging easier, better error reports
const uglify_options = { compress: false, mangle: false };

// if (args.debug) {
//   const node_inspector = require('gulp-node-inspector'); // eslint-disable-line global-require
//   gulp.task('inspect', function () {
//     gulp.src([]).pipe(node_inspector({
//       debugPort: 5858,
//       webHost: '0.0.0.0',
//       webPort: '8080',
//       preload: false
//     }));
//   });
// }

gulp.task('server_js', function () {
  return gulp.src(config.server_js_files)
    .pipe(sourcemaps.init())
    .pipe(newer('./dist/game/build.dev'))
    .pipe(babel())
    .pipe(sourcemaps.write('.'))
    .pipe(gulp.dest('./dist/game/build.dev'));
});

gulp.task('eslint', function () {
  return gulp.src(config.all_js_files)
    .pipe(eslint())
    .pipe(eslint.format());
});

//////////////////////////////////////////////////////////////////////////
// client tasks
const default_defines = {
  ENV: 'default',
};
gulp.task('client_html_default', function () {
  return gulp.src(config.client_html)
    .pipe(useref({}, lazypipe().pipe(sourcemaps.init, { loadMaps: true })))
    .on('error', log.error.bind(log, 'client_html Error'))
    .pipe(ifdef(default_defines, { extname: ['html'] }))
    .pipe(sourcemaps.write('./')) // writes .map file
    .pipe(gulp.dest('./dist/game/build.dev/client'));
});

const extra_index = [
//  {
//    name: 'staging',
//    defines: {
//      ENV: 'staging',
//    },
//    zip: true,
//  },
];

let client_html_tasks = ['client_html_default'];
extra_index.forEach(function (elem) {
  let name = `client_html_${elem.name}`;
  client_html_tasks.push(name);
  gulp.task(name, function () {
    return gulp.src(config.client_html_index)
      .pipe(useref({}, lazypipe().pipe(sourcemaps.init, { loadMaps: true })))
      .on('error', log.error.bind(log, 'client_html Error'))
      .pipe(ifdef(elem.defines, { extname: ['html'] }))
      .pipe(rename(`index_${elem.name}.html`))
      .pipe(sourcemaps.write('./')) // writes .map file
      .pipe(gulp.dest('./dist/game/build.dev/client'));
  });
});

gulp.task('client_html', gulp.parallel(...client_html_tasks));

gulp.task('client_css', function () {
  return gulp.src(config.client_css)
    .pipe(gulp.dest('./dist/game/build.dev/client'))
    .pipe(browser_sync.reload({ stream: true }));
});

gulp.task('client_static', function () {
  return gulp.src(config.client_static)
    .pipe(newer('./dist/game/build.dev/client'))
    .pipe(gulp.dest('./dist/game/build.dev/client'));
});

gulp.task('client_fsdata', function () {
  return gulp.src(config.client_fsdata, { base: 'src/client' })
    .pipe(webfs())
    .pipe(gulp.dest('./dist/game/build.dev/client'));
});

//////////////////////////////////////////////////////////////////////////
// Fork of https://github.com/Jam3/brfs-babel that adds bablerc:false
const babel_core = require('babel-core');
const through = require('through2');
const babel_static_fs = require('babel-plugin-static-fs');
function babelBrfs(filename, opts) {
  let input = '';
  if ((/\.json$/iu).test(filename)) {
    return through();
  }

  function write(buf, enc, next) {
    input += buf.toString();
    next();
  }

  function flush(next) {
    let result;
    try {
      result = babel_core.transform(input, {
        plugins: [
          [
            babel_static_fs, {
              // ensure static-fs files are discovered
              onFile: this.emit.bind(this, 'file'),
              dynamic: false,
            }
          ]
        ],
        filename: filename,
        babelrc: false,
      });
      this.push(result.code);
      this.push(null);
      return next();
    } catch (err) {
      return next(err);
    }
  }

  return through(write, flush);
}
// End fork of https://github.com/Jam3/brfs-babel
//////////////////////////////////////////////////////////////////////////

let client_js_deps = [];
let client_js_watch_deps = [];

function bundleJS(filename, is_worker, pre_task) {
  let bundle_name = filename.replace('.js', '.bundle.js');
  const browserify_opts = {
    entries: [
      `./src/client/${filename}`,
    ],
    cache: {}, // required for watchify
    packageCache: {}, // required for watchify
    builtins: {
      // super-simple replacements, if needed
      assert: './src/client/shims/assert.js',
      buffer: './src/client/shims/buffer.js',
      not_worker: !is_worker && './src/client/shims/not_worker.js',
      // timers: './src/client/shims/timers.js',
      _process: './src/client/shims/empty.js',
    },
    debug: true,
    transform: [babelBrfs]
  };
  const babelify_opts = {
    global: true, // Required because dot-prop has ES6 code in it
    plugins: [],
    // plugins: [
    //   // ['syntax-object-rest-spread', {}],
    //   // ['transform-object-rest-spread', {}],
    //   // ['static-fs', {}], - generates good code, but does not allow reloading/watchify
    // ],
  };
  function whitespaceReplace(a) {
    // gulp-replace-with-sourcemaps doens't seem to work, so just replace with exactly matching whitespace
    return a.replace(/[^\n\r]/g, ' ');
  }


  let build_timestamp = Date.now();
  function buildTimestampReplace() {
    // Must be exactly 'BUILD_TIMESTAMP'.length (15) characters long
    let ret = `'${build_timestamp}'`;
    assert.equal(ret.length, 15);
    return ret;
  }
  function dobundle(b) {
    build_timestamp = Date.now();
    log(`Using BUILD_TIMESTAMP=${build_timestamp} for ${filename}`);
    return b
      //.transform(babelify, babelify_opts)
      .bundle()
      // log errors if they happen
      .on('error', log.error.bind(log, 'Browserify Error'))
      .pipe(vinyl_source_stream(bundle_name))
      // optional, remove if you don't need to buffer file contents
      .pipe(vinyl_buffer())
      // optional, remove if you don't want sourcemaps
      .pipe(sourcemaps.init({ loadMaps: true })) // loads map from browserify file
      // Remove extra Babel stuff that does not help anything
      .pipe(replace(/_classCallCheck\([^)]+\);|exports\.__esModule = true;/g, whitespaceReplace))
      .pipe(replace(/function _classCallCheck\((?:[^}]*\}){2}/g, whitespaceReplace))
      .pipe(replace(/Object\.defineProperty\(exports, "__esModule"[^}]+\}\);/g, whitespaceReplace))
      .pipe(replace('BUILD_TIMESTAMP', buildTimestampReplace))
      // Add transformation tasks to the pipeline here.
      .pipe(uglify(uglify_options))
      .pipe(sourcemaps.write('./')) // writes .map file
      .pipe(gulp.dest('./dist/game/build.dev/client/'));
  }

  function writeVersion(done) {
    let ver_filename = `${filename.slice(0, -3)}.ver.json`;
    fs.writeFile(`./dist/game/build.dev/client/${ver_filename}`, `{"ver":"${build_timestamp}"}`, done);
  }
  let version_task = `client_js_${filename}_version`;
  gulp.task(version_task, writeVersion);

  function registerTasks(b, watch) {
    let task_base = `client_js${watch ? '_watch' : ''}_${filename}`;
    b.transform(babelify, babelify_opts);
    b.on('log', log); // output build logs to terminal
    if (watch) {
      client_js_watch_deps.push(task_base);
    } else {
      client_js_deps.push(task_base);
    }
    gulp.task(`${task_base}_bundle`, function () {
      let ret = dobundle(b);
      if (watch) {
        ret = ret.pipe(browser_sync.stream({ once: true }));
      }
      return ret;
    });
    if (pre_task) {
      gulp.task(task_base, gulp.series(pre_task, `${task_base}_bundle`, version_task));
    } else {
      gulp.task(task_base, gulp.series(`${task_base}_bundle`, version_task));
    }
  }
  const watched = watchify(browserify(browserify_opts));
  registerTasks(watched, true);
  // on any dep update, runs the bundler
  watched.on('update', gulp.series(`client_js_watch_${filename}_bundle`, writeVersion));

  const nonwatched = browserify(browserify_opts);
  registerTasks(nonwatched, false);
}

bundleJS('app.js');

gulp.task('build.prod.compress', function () {
  return gulp.src('dist/game/build.dev/**')
    .pipe(gulp.dest('./dist/game/build.prod'))
    // skipLarger so we don't end up with orphaned old compressed files
    .pipe(gulpif(config.compress_files, web_compress({ skipLarger: false })))
    .pipe(gulp.dest('./dist/game/build.prod'));
});
gulp.task('nop', function (next) {
  next();
});
let zip_tasks = [];
extra_index.forEach(function (elem) {
  if (!elem.zip) {
    return;
  }
  let name = `build.zip.${elem.name}`;
  zip_tasks.push(name);
  gulp.task(name, function () {
    return gulp.src('dist/game/build.dev/client/**')
      .pipe(ignore.exclude('index.html'))
      .pipe(ignore.exclude('*.map'))
      .pipe(gulpif(`index_${elem.name}.html`, rename('index.html')))
      .pipe(ignore.exclude('index_*.html'))
      .pipe(zip(`${elem.name}.zip`))
      .pipe(gulp.dest('./dist/game/build.prod/client'));
  });
});
if (!zip_tasks.length) {
  zip_tasks.push('nop');
}
gulp.task('build.zip', gulp.parallel(...zip_tasks));
gulp.task('build.prod.package', function () {
  return gulp.src('package*.json')
    .pipe(gulp.dest('./dist/game/build.prod'));
});
gulp.task('build.prod', gulp.parallel('build.prod.package', 'build.prod.compress', 'build.zip'));

gulp.task('client_js', gulp.parallel(...client_js_deps));
gulp.task('client_js_watch', gulp.parallel(...client_js_watch_deps));

//////////////////////////////////////////////////////////////////////////
// Combined tasks

gulp.task('client_fsdata_wrap', gulp.series('client_fsdata'));

gulp.task('build', gulp.series(gulp.parallel('eslint', 'server_js', 'client_html',
  'client_css', 'client_static', 'client_js', 'client_fsdata_wrap'), 'build.prod'));

gulp.task('bs-reload', (done) => {
  browser_sync.reload();
  done();
});

gulp.task('watch', gulp.series(
  gulp.parallel('eslint', 'server_js', 'client_html', 'client_css', 'client_static',
    'client_fsdata_wrap', 'client_js_watch'),
  (done) => {
    if (!args.nolint) {
      gulp.watch(config.all_js_files, gulp.series('eslint'));
    }
    gulp.watch(config.server_js_files, gulp.series('server_js'));
    gulp.watch(config.client_html, gulp.series('client_html', 'bs-reload'));
    gulp.watch(config.client_vendor, gulp.series('client_html', 'bs-reload'));
    gulp.watch(config.client_css, gulp.series('client_css'));
    gulp.watch(config.client_static, gulp.series('client_static'));
    gulp.watch(config.client_fsdata, gulp.series('client_fsdata'));
    done();
  }
));

const deps = ['watch'];
if (args.debug) {
  deps.push('inspect');
}

// Depending on "watch" not because that implicitly triggers this, but
// just to start up the watcher and reprocessor, and nodemon restarts
// based on its own logic below.
gulp.task('nodemon', gulp.series(...deps, (done) => {
  const options = {
    script: 'dist/game/build.dev/server/index.js',
    nodeArgs: ['--inspect'],
    args: ['--dev'],
    watch: ['dist/game/build.dev/server/', 'dist/game/build.dev/common'],
  };

  if (args.debug) {
    options.nodeArgs.push('--debug');
  }

  if (args.port) {
    options.args.push(`--port=${args.port}`);
    assert.equal(options.nodeArgs[0], '--inspect');
    options.nodeArgs[0] = `--inspect=${9229 + Number(args.port) - 3000}`;
  }

  nodemon(options);
  done();
}));

gulp.task('browser-sync', gulp.series('nodemon', (done) => {

  // for more browser-sync config options: http://www.browsersync.io/docs/options/
  browser_sync({

    // informs browser-sync to proxy our expressjs app which would run at the following location
    proxy: {
      target: `http://localhost:${args.port || process.env.port || 3000}`,
      ws: true,
    },

    // informs browser-sync to use the following port for the proxied app
    // notice that the default port is 3000, which would clash with our expressjs
    port: 4000,

    // // open the proxied app in chrome
    // browser: ['google-chrome'],

    // don't sync clicks/scrolls/forms/etc
    ghostMode: false,
  });
  done();
}));

gulp.task('clean', function () {
  return gulp.src([
    'build.dev',
    'build.prod',
    'dist/game/build.dev',
    'dist/game/build.prod',
    'src/client/autogen/*.*',
    '!src/client/autogen/placeholder.txt',
  ], { read: false, allowEmpty: true })
    .pipe(clean());
});
