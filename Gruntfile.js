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

        bgShell: {
            cover: {
                cmd: "./node_modules/.bin/nyc -x Gruntfile.js -x 'test/**' ./node_modules/.bin/grunt -- test",
                fail: true,
                execOpts: {
                    maxBuffer: 0
                }
            },

            cover_report: {
                cmd: "./node_modules/.bin/nyc report -r lcov",
                fail: true
            },

            cover_check: {
                cmd: './node_modules/.bin/nyc check-coverage --statements 100 --branches 100 --functions 100 --lines 100',
                fail: true
            },

            coveralls: {
                cmd: 'cat coverage/lcov.info | coveralls',
                fail: true
            },

            webpack: {
                cmd: './node_modules/.bin/webpack',
                fail: true
            },

            keys: {
                cmd: './test/keys.sh',
                fail: true
            }
        }
    });

    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-mocha-test');
    grunt.loadNpmTasks('grunt-bg-shell');

    grunt.registerTask('lint', 'jshint');
    grunt.registerTask('keys', 'bgShell:keys');
    grunt.registerTask('test', 'mochaTest');
    grunt.registerTask('docs', 'bgShell:jsdoc');
    grunt.registerTask('dist', 'bgShell:webpack');
    grunt.registerTask('coverage', ['bgShell:cover',
                                    'bgShell:cover_report',
                                    'bgShell:cover_check']);
    grunt.registerTask('coveralls', 'bgShell:coveralls');
    grunt.registerTask('default', ['lint', 'test']);
};

