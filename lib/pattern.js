/*eslint-env node */
"use strict";

exports.get_topic_pattern = function (config)
{
    const sep = `\\u${config.separator.codePointAt(0).toString(16).padStart(4, '0')}`;
    const ws = `\\u${config.wildcard_some.codePointAt(0).toString(16).padStart(4, '0')}`;

    const non_seps = `[^${sep}]*`;
    const re_max_words = `${non_seps}(${sep}${non_seps}){0,${config.max_words-1}}`;
    const wsw = `((?<=(^|${sep}))${ws}(?=($|${sep})))`;
    const non_wsw = `([^${ws}]|((?<!(^|${sep}))${ws})|${ws}(?!($|${sep})))*`;
    const re_max_wildcard_somes = `${non_wsw}(${wsw}${non_wsw}){0,${config.max_wildcard_somes}}`;

    let re_topic = `^(?=${re_max_words}$)(?=${re_max_wildcard_somes}$)`;

    if (config.max_topic_length !== undefined)
    {
        const re_max_topic_length = `.{0,${config.max_topic_length}}`;
        re_topic += `(?=${re_max_topic_length}$)`;
    }

    return re_topic;
};
