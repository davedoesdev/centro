module.exports = {
    env: {
        es6: true
    },
    parserOptions: {
        ecmaVersion: 2018,
        sourceType: "script"
    },
    extends: "eslint:recommended",
    parser: "babel-eslint",
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
