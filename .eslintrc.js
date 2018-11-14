module.exports = {
    env: {
        es6: true
    },
    parserOptions: {
        ecmaVersion: 2018
    },
    extends: "eslint:recommended",
    rules: {
        "no-unused-vars": [
            "error", {
                varsIgnorePattern: "^unused_",
                argsIgnorePattern: "^unused_"
            }
        ],
        strict: [ "error", "safe" ]
    }
};
