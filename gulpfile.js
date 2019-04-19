/* eslint no-invalid-this:off */
const args = require('yargs').argv;
const babel = require('gulp-babel');
const babelify = require('babelify');
const browserify = require('browserify');
const browser_sync = require('browser-sync');
const buffer = require('vinyl-buffer');
const gulp = require('gulp');
const gulpif = require('gulp-if');
const eslint = require('gulp-eslint');
const lazypipe = require('lazypipe');
const log = require('fancy-log');
const useref = require('gulp-useref');
const uglify = require('gulp-uglify');
// const node_inspector = require('gulp-node-inspector');
const nodemon = require('gulp-nodemon');
const replace = require('gulp-replace');
const source = require('vinyl-source-stream');
const sourcemaps = require('gulp-sourcemaps');
const watchify = require('watchify');

//////////////////////////////////////////////////////////////////////////
// Server tasks
const config = {
  js_files: ['src/**/*.js', '!src/client/**/*.js'],
  all_js_files: ['src/**/*.js', '!src/client/vendor/**/*.js'],
  client_html: ['src/client/**/*.html'],
  client_css: ['src/client/**/*.css', '!src/client/sounds/Bfxr/**'],
  client_static: [
    'src/client/**/*.mp3',
    'src/client/**/*.wav',
    'src/client/**/*.ogg',
    'src/client/**/*.png',
    '!src/client/sounds/Bfxr/**',
    // 'src/client/**/vendor/**',
  ],
  client_vendor: ['src/client/**/vendor/**'],
};

const uglify_options_release = { keep_fnames: true };

// Same as release:
// const uglify_options_dev = { keep_fnames: true };
// Do no significant minification to make debugging easier:
const uglify_options_dev = { compress: false, mangle: false };

// gulp.task('inspect', function () {
//   gulp.src([]).pipe(node_inspector({
//     debugPort: 5858,
//     webHost: '0.0.0.0',
//     webPort: '8080',
//     preload: false
//   }));
// });

gulp.task('js', function () {
  return gulp.src(config.js_files)
    .pipe(sourcemaps.init())
    .pipe(babel())
    .pipe(sourcemaps.write('.'))
    .pipe(gulp.dest('./build'));
});

gulp.task('eslint', function () {
  return gulp.src(config.all_js_files)
    .pipe(eslint())
    .pipe(eslint.format());
});

//////////////////////////////////////////////////////////////////////////
// client tasks
gulp.task('client_html', function () {
  return gulp.src(config.client_html)
    // .pipe(jshint.extract('auto'))
    // .pipe(eslint())
    // .pipe(eslint.format())
    .pipe(useref({}, lazypipe().pipe(sourcemaps.init, { loadMaps: true })))
    .pipe(gulpif('*.js', uglify(uglify_options_release)))
    .on('error', log.error.bind(log, 'client_html Error'))
    .pipe(sourcemaps.write('./')) // writes .map file
    .pipe(gulp.dest('./build/client'));
});

gulp.task('client_css', function () {
  return gulp.src(config.client_css)
    .pipe(gulp.dest('./build/client'))
    .pipe(browser_sync.reload({ stream: true }));
});

gulp.task('client_static', function () {
  return gulp.src(config.client_static)
    .pipe(gulp.dest('./build/client'));
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
              onFile: this.emit.bind(this, 'file')
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

(function () {
  const browserify_opts = {
    entries: ['./src/client/wrapper.js'],
    cache: {}, // required for watchify
    packageCache: {}, // required for watchify
    builtins: {
      // super-simple replacements, if needed
      assert: './src/client/shims/assert.js',
      buffer: './src/client/shims/buffer.js',
      // timers: './src/client/shims/timers.js',
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
    return a.replace(/[^\n\r]/gu, ' ');
  }
  function dobundle(b, uglify_options) {
    return b
      //.transform(babelify, babelify_opts)
      .bundle()
      // log errors if they happen
      .on('error', log.error.bind(log, 'Browserify Error'))
      .pipe(source('wrapper.bundle.js'))
      // optional, remove if you don't need to buffer file contents
      .pipe(buffer())
      // optional, remove if you don't want sourcemaps
      .pipe(sourcemaps.init({ loadMaps: true })) // loads map from browserify file
      // Remove extra Babel stuff that does not help anything
      .pipe(replace(/_classCallCheck\([^)]+\);|exports\.__esModule = true;/gu, whitespaceReplace))
      .pipe(replace(/function _classCallCheck\((?:[^}]*\}){2}/gu, whitespaceReplace))
      .pipe(replace(/Object\.defineProperty\(exports, "__esModule"[^}]+\}\);/gu, whitespaceReplace))
      // Add transformation tasks to the pipeline here.
      .pipe(uglify(uglify_options))
      .pipe(sourcemaps.write('./')) // writes .map file
      .pipe(gulp.dest('./build/client/'));
  }

  const watched = watchify(browserify(browserify_opts));
  watched.transform(babelify, babelify_opts);

  watched.on('update', function () {
    console.log('Task:client_js_watch::update');
    // on any dep update, runs the bundler
    dobundle(watched, uglify_options_dev)
      .pipe(browser_sync.stream({ once: true }));
  });
  watched.on('log', log); // output build logs to terminal
  gulp.task('client_js_watch', function () {
    return dobundle(watched, uglify_options_dev);
  });

  const nonwatched = browserify(browserify_opts);
  nonwatched.transform(babelify, babelify_opts);
  nonwatched.on('log', log); // output build logs to terminal
  gulp.task('client_js', function () {
    return dobundle(nonwatched, uglify_options_release);
  });
}());

//////////////////////////////////////////////////////////////////////////
// Combined tasks

gulp.task('build', ['eslint', 'js', 'client_html', 'client_css', 'client_static', 'client_js']);

gulp.task('bs-reload', ['client_static', 'client_html'], () => {
  browser_sync.reload();
});

gulp.task('watch', ['eslint', 'js', 'client_html', 'client_css', 'client_static', 'client_js_watch'], () => {
  gulp.watch(config.js_files, ['js']);
  gulp.watch(config.all_js_files, ['eslint']);
  gulp.watch(config.client_html, ['client_html', 'bs-reload']);
  gulp.watch(config.client_vendor, ['client_html', 'bs-reload']);
  gulp.watch(config.client_css, ['client_css']);
  gulp.watch(config.client_static, ['client_static', 'bs-reload']);
});

const deps = ['watch'];
if (args.debug) {
  deps.push('inspect');
}

// Depending on "watch" not because that implicitly triggers this, but
// just to start up the watcher and reprocessor, and nodemon restarts
// based on its own logic below.
gulp.task('nodemon', deps, () => {
  const options = {
    script: 'build/server/index.js',
    nodeArgs: [],
    args: ['--dev'],
    watch: ['build/server/'],
  };
  if (args.debug) {
    options.nodeArgs.push('--debug');
  }
  nodemon(options);
});

gulp.task('browser-sync', ['nodemon'], () => {

  // for more browser-sync config options: http://www.browsersync.io/docs/options/
  browser_sync({

    // informs browser-sync to proxy our expressjs app which would run at the following location
    proxy: 'http://localhost:3000',

    // informs browser-sync to use the following port for the proxied app
    // notice that the default port is 3000, which would clash with our expressjs
    port: 4000,

    // // open the proxied app in chrome
    // browser: ['google-chrome'],
  });
});
