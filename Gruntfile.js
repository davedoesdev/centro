"use strict";

var path = require('path'),
    mod_path = path.join('.', 'node_modules'),
    bin_path = path.join(mod_path, '.bin'),
    nyc_path = path.join(bin_path, 'nyc'),
    grunt_path;

if (process.platform === 'win32')
{
    grunt_path = path.join(mod_path, 'grunt', 'bin', 'grunt');
}
else
{
    grunt_path = path.join(bin_path, 'grunt');
}

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
                cmd: nyc_path + " -x Gruntfile.js -x \"" + path.join('test', '**') + "\" node --napi-modules " + grunt_path + " test"
            },

            cover_report: {
                cmd: nyc_path + ' report -r lcov'
            },

            cover_check: {
                cmd: nyc_path + ' check-coverage --statements 100 --branches 100 --functions 100 --lines 100'
            },

            coveralls: {
                cmd: 'cat coverage/lcov.info | ./node_modules/.bin/coveralls'
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

            prep_documentation: {
                cmd: 'if [ ! -e node_modules/documentation/lib ]; then npm explore documentation -- npm install && npm explore documentation -- npm run build; fi'
            },

            documentation: {
                cmd: './node_modules/.bin/documentation build -c documentation.yml -f html -o docs index.js lib/server_transports/*.js lib/server_extensions/*.js'
            },

            serve_documentation: {
                cmd: './node_modules/.bin/documentation serve -w -c documentation.yml index.js lib/server_transports/*.js lib/server_extensions/*.js'
            },

            prep_matic: {
                cmd: 'if [ ! -e node_modules/matic/node_modules/jade ]; then npm explore matic -- npm install; fi'
            },

            default_schema: {
                cmd: 'mkdir -p docs/schema/schemas && node --napi-modules -p \'JSON.stringify(require("./lib/server_config.js").default_authz_token_schema, null, 2)\' > docs/schema/schemas/default_authz_token.schema.json && cd docs/schema && ../../node_modules/.bin/matic'
            }
        }
    });

    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-mocha-test');
    grunt.loadNpmTasks('grunt-exec');

    grunt.registerTask('lint', 'jshint');
    grunt.registerTask('keys', 'exec:keys');
    grunt.registerTask('dist', 'exec:webpack');
    grunt.registerTask('check_dist', 'exec:check_dist');
    grunt.registerTask('test', 'mochaTest');
    grunt.registerTask('docs', ['exec:prep_documentation',
                                'exec:documentation',
                                'exec:prep_matic',
                                'exec:default_schema']);
    grunt.registerTask('serve_docs', ['exec:prep_documentation',
                                      'exec:serve_documentation']);
    grunt.registerTask('coverage', ['exec:cover',
                                    'exec:cover_report',
                                    'exec:cover_check']);
    grunt.registerTask('coveralls', 'exec:coveralls');
    grunt.registerTask('default', ['lint', 'test']);
};

