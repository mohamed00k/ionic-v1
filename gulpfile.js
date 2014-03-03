var _ = require('lodash');
var buildConfig = require('./config/build.config.js');
var connect = require('connect');
var dgeni = require('dgeni');
var http = require('http');
var cp = require('child_process');
var fs = require('fs');
var gulp = require('gulp');
var pkg = require('./package.json');
var through = require('through');

var argv = require('minimist')(process.argv.slice(2));

var bump = require('gulp-bump');
var concat = require('gulp-concat');
var cssmin = require('gulp-cssmin');
var gulpif = require('gulp-if');
var header = require('gulp-header');
var jshint = require('gulp-jshint');
var rename = require('gulp-rename');
var sass = require('gulp-sass');
var stripDebug = require('gulp-strip-debug');
var template = require('gulp-template');
var uglify = require('gulp-uglify');
var gutil = require('gulp-util');

var banner = _.template(buildConfig.banner, { pkg: pkg });

var IS_RELEASE_BUILD = !!argv.release;
if (IS_RELEASE_BUILD) {
  gutil.log(gutil.colors.red('--release=true:'),
    'Building release version (minified, debugs stripped)...'
  );
}

gulp.task('default', ['build']);
gulp.task('build', ['bundle', 'sass']);

gulp.task('docs', function() {
  dgeni('docs/docs.config.js').generateDocs();
});

gulp.task('watch', function() {
  gulp.watch('js/**/*.js', ['bundle', 'docs']);
  gulp.watch('docs/**/*', ['docs']);
  gulp.watch('scss/**/*.scss', ['sass']);
});

gulp.task('bundle', [
  'scripts',
  'scripts-ng',
  'vendor',
  'version',
], function() {
  IS_RELEASE_BUILD && gulp.src(buildConfig.ionicBundleFiles.map(function(src) {
      return src.replace(/.js$/, '.min.js');
    }))
      .pipe(header(buildConfig.bundleBanner))
      .pipe(concat('ionic.bundle.min.js'))
      .pipe(gulp.dest(buildConfig.distJs));

  return gulp.src(buildConfig.ionicBundleFiles)
    .pipe(header(buildConfig.bundleBanner))
    .pipe(concat('ionic.bundle.js'))
    .pipe(gulp.dest(buildConfig.distJs));
});

gulp.task('jshint', function() {
  return gulp.src(['js/**/*.js', 'test/**/*.js'])
    .pipe(jshint('.jshintrc'))
    .pipe(jshint.reporter('jshint-stylish'));
});

gulp.task('ddescribe-iit', function() {
  return gulp.src(['test/**/*.js', 'js/**/*.js'])
    .pipe(notContains([
      'ddescribe',
      'iit',
      'xit',
      'xdescribe'
    ]));
});

gulp.task('version', function(done) {
  var d = new Date();
  fs.writeFile('dist/version.json', JSON.stringify({
    version: pkg.version,
    codename: pkg.codename,
    date: d.toISOString().substring(0,10),
    time: pad(d.getUTCHours()) +
      ':' + pad(d.getUTCMinutes()) +
      ':' + pad(d.getUTCSeconds())
  }, null, 2), done);
});

gulp.task('vendor', function() {
  return gulp.src(buildConfig.vendorFiles, {
      cwd: 'config/lib/',
      base: 'config/lib/'
    })
    .pipe(gulp.dest(buildConfig.dist));
});

gulp.task('scripts', function() {
  return gulp.src(buildConfig.ionicFiles)
    .pipe(concat('ionic.js'))
    .pipe(gulpif(IS_RELEASE_BUILD, stripDebug()))
    .pipe(gulp.dest(buildConfig.distJs))
    .pipe(gulpif(IS_RELEASE_BUILD, uglify()))
    .pipe(header(banner))
    .pipe(rename({ extname: '.min.js' }))
    .pipe(gulp.dest(buildConfig.distJs));
});

gulp.task('scripts-ng', function() {
  return gulp.src(buildConfig.angularIonicFiles)
    .pipe(header(banner))
    .pipe(concat('ionic-angular.js'))
    .pipe(gulpif(IS_RELEASE_BUILD, uglify()))
    .pipe(gulp.dest(buildConfig.distJs))
    .pipe(gulpif(IS_RELEASE_BUILD, stripDebug()))
    .pipe(header(banner))
    .pipe(rename({ extname: '.min.js' }))
    .pipe(gulp.dest(buildConfig.distJs));
});

gulp.task('sass', function() {
  return gulp.src('scss/ionic.scss')
    .pipe(header(banner))
    .pipe(sass())
    .pipe(concat('ionic.css'))
    .pipe(gulp.dest(buildConfig.distCss))
    .pipe(gulpif(IS_RELEASE_BUILD, cssmin()))
    .pipe(header(banner))
    .pipe(rename({ extname: '.min.css' }))
    .pipe(gulp.dest(buildConfig.distCss));
});

gulp.task('sauce-connect', sauceConnect);

gulp.task('cloudtest', ['protractor-sauce'], function(cb) {
  sauceDisconnect(cb);
});

gulp.task('karma', function(cb) {
  return karma(cb, ['config/karma.conf.js', '--single-run=true']);
});
gulp.task('karma-watch', function(cb) {
  return karma(cb, ['config/karma.conf.js']);
});

var connectServer;
gulp.task('connect-server', function() {
  var app = connect().use(connect.static(__dirname));
  connectServer = http.createServer(app).listen(8765);
});
gulp.task('protractor', ['connect-server'], function(cb) {
  return protractor(cb, ['config/protractor.conf.js']);
});
gulp.task('protractor-sauce', ['sauce-connect', 'connect-server'], function(cb) {
  return protractor(cb, ['config/protractor-sauce.conf.js']);
});

gulp.task('e2e-local', ['connect-server'], function(cb) {
});
gulp.task('e2e-sauce', ['sauce-connect', 'connect-server'], function(cb) {
});

function karma(cb, args) {
  if (argv.browsers) {
    args.push('--browsers='+argv.browsers.trim());
  }
  if (argv.reporters) {
    args.push('--reporters='+argv.reporters.trim());
  }
  cp.spawn('node', [
    './node_modules/karma/bin/karma',
    'start'
  ].concat(args), { stdio: 'inherit' })
  .on('exit', function(code) {
    if (code) return cb('Karma test(s) failed. Exit code: ' + code);
    cb();
  });
}

function pad(n) {
  if (n<10) return '0' + n;
  return n;
}

function protractor(cb, args) {
  cp.spawn('protractor', args, { stdio: 'inherit' })
  .on('exit', function(code) {
    connectServer && connectServer.close();
    if (code) return cb('Protector test(s) failed. Exit code: ' + code);
    cb();
  });
}

var sauceInstance;
function sauceConnect(cb) {
  require('sauce-connect-launcher')({
    username: process.env.SAUCE_USER,
    accessKey: process.env.SAUCE_KEY,
    verbose: true,
    tunnelIdentifier: process.env.TRAVIS_BUILD_NUMBER
  }, function(err, instance) {
    if (err) return cb('Failed to launch sauce connect!');
    sauceInstance = instance;
    cb();
  });
}

function sauceDisconnect(cb) {
  if (sauceInstance) {
    return sauceInstance.close(cb);
  }
  cb();
}

function notContains(disallowed) {
  disallowed = disallowed || [];

  return through(function(file) {
    var error;
    var contents = file.contents.toString();
    disallowed.forEach(function(str) {
      var idx = disallowedIndex(contents, str);
      if (idx !== -1) {
        error = error || file.path + ' contains ' + str + ' on line ' +
          contents.substring(0, idx, str).split('\n').length + '!';
      }
    });
    if (error) {
      throw new Error(error);
    } else {
      this.emit('data', file);
    }
  });

  function disallowedIndex(content, disallowedString) {
    var notFunctionName = '[^A-Za-z0-9$_]';
    var regex = new RegExp('(^|' + notFunctionName + ')(' + disallowedString + ')' + notFunctionName + '*\\(', 'gm');
    var match = regex.exec(content);
    // Return the match accounting for the first submatch length.
    return match !== null ? match.index + match[1].length : -1;
  }
}
