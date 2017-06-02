"use strict";

module.exports = function (grunt)
{
    grunt.initConfig(
    {
        jshint: {
            src: [ 'index.js', 'Gruntfile.js', 'lib/**/*.js', 'test/**/*.js' ],
            options: {
                node: true,
                esversion: 6
            }
        },

        mochaTest: {
            src: [ 'test/in-mem.js',
                   'test/tcp.js',
                   'test/primus.js',
                   'test/embedded.js',
                   'test/embedded-authz.js',
                   'test/http.js',
                   'test/in-mem-fsq.js',
                   'test/in-mem-anon.js',
                   'test/server-extra.js',
                   'test/read_frame-error.js',
                   'test/connect-after-close.js',
                   'test/pipeline.js',
                   'test/sep-auth-no-config.js',
                   'test/example/example.js' ],
            options: {
                bail: true
            }
        },

        apidox: {
            input: [ 'index.js', 'events_doc.js' ],
            output: 'README.md',
            fullSourceDescription: true,
            extraHeadingLevels: 1
        },

        exec: {
            cover: {
                cmd: "./node_modules/.bin/nyc -x Gruntfile.js -x 'test/**' ./node_modules/.bin/grunt -- test"
            },

            cover_report: {
                cmd: "./node_modules/.bin/nyc report -r lcov"
            },

            cover_check: {
                cmd: './node_modules/.bin/nyc check-coverage --statements 100 --branches 100 --functions 100 --lines 100'
            },

            coveralls: {
                cmd: 'cat coverage/lcov.info | coveralls'
            },

            webpack: {
                cmd: './node_modules/.bin/removeNPMAbsolutePaths node_modules && ./node_modules/.bin/webpack'
            },

            check_dist: {
                cmd: './node_modules/.bin/removeNPMAbsolutePaths node_modules && ./node_modules/.bin/webpack --config webpack.check.config && diff -u dist/centro.js dist/check.js && rm -f dist/check.js'
            },

            keys: {
                cmd: './test/keys.sh'
            }
        }
    });

    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-mocha-test');
    grunt.loadNpmTasks('grunt-exec');

    grunt.registerTask('lint', 'jshint');
    grunt.registerTask('keys', 'exec:keys');
    grunt.registerTask('test', 'mochaTest');
    grunt.registerTask('docs', 'exec:jsdoc');
    grunt.registerTask('dist', 'exec:webpack');
    grunt.registerTask('check_dist', 'exec:check_dist');
    grunt.registerTask('coverage', ['exec:cover',
                                    'exec:cover_report',
                                    'exec:cover_check']);
    grunt.registerTask('coveralls', 'exec:coveralls');
    grunt.registerTask('default', ['lint', 'test']);

	// For Node 0.12:
	// https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/String/endsWith#Polyfill
	if (!String.prototype.endsWith) {
	  String.prototype.endsWith = function(searchString, position) {
		  var subjectString = this.toString();
		  if (typeof position !== 'number' || !isFinite(position) || Math.floor(position) !== position || position > subjectString.length) {
			position = subjectString.length;
		  }
		  position -= searchString.length;
		  var lastIndex = subjectString.lastIndexOf(searchString, position);
		  return lastIndex !== -1 && lastIndex === position;
	  };
	}
};

