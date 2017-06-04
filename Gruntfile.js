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

        exec: {
            cover: {
                cmd: "./node_modules/.bin/nyc -x Gruntfile.js -x 'test/**' ./node_modules/.bin/grunt test"
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
            },

            documentation: {
                cmd: './node_modules/.bin/documentation build -c documentation.yml -f html -o docs'
            },

            serve_documentation: {
                cmd: './node_modules/.bin/documentation serve -w -c documentation.yml'
            }
        }
    });

    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-mocha-test');
    grunt.loadNpmTasks('grunt-exec');

    grunt.registerTask('lint', 'jshint');
    grunt.registerTask('keys', 'exec:keys');
    grunt.registerTask('test', 'mochaTest');
    grunt.registerTask('docs', 'exec:documentation');
    grunt.registerTask('serve_docs', 'exec:serve_documentation');
    grunt.registerTask('dist', 'exec:webpack');
    grunt.registerTask('check_dist', 'exec:check_dist');
    grunt.registerTask('coverage', ['exec:cover',
                                    'exec:cover_report',
                                    'exec:cover_check']);
    grunt.registerTask('coveralls', 'exec:coveralls');
    grunt.registerTask('default', ['lint', 'test']);
};

