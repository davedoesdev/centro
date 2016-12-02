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
                   'test/server-error.js',
                   'test/read_frame-error.js',
                   'test/connect-after-close.js',
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

        shell: {
            cover: {
                command: './node_modules/.bin/istanbul cover -x Gruntfile.js ./node_modules/.bin/grunt -- test',
                execOptions: {
                    maxBuffer: 10000 * 1024
                }
            },

            check_cover: {
                command: './node_modules/.bin/istanbul check-coverage --statement 100 --branch 100 --function 100 --line 100'
            },

            coveralls: {
                command: 'cat coverage/lcov.info | coveralls'
            },

            webpack: {
                command: './node_modules/.bin/webpack'
            },

            keys: {
                command: './test/keys.sh'
            }
        }
    });

    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-mocha-test');
    grunt.loadNpmTasks('grunt-shell');
    grunt.loadNpmTasks('grunt-apidox');

    grunt.registerTask('lint', 'jshint');
    grunt.registerTask('keys', 'shell:keys');
    grunt.registerTask('test', 'mochaTest');
    grunt.registerTask('docs', 'apidox');
    grunt.registerTask('dist', 'shell:webpack');
    grunt.registerTask('coverage', ['shell:cover', 'shell:check_cover']);
    grunt.registerTask('coveralls', 'shell:coveralls');
    grunt.registerTask('default', ['lint', 'test']);
};

