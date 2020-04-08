/*eslint-env node */
"use strict";

var authorize_jwt = require('authorize-jwt'),
    { get_topic_pattern } = require('./pattern');

exports.config_with_defaults = function (config)
{
    return Object.assign(
    {
        authorize: authorize_jwt,                  // centro server
        privileged: false,                         // centro server
        transport: [],                             // centro server
        realm: 'centro',                           // centro server
        auth_method: 'Bearer',                     // centro server
        max_issuer_length: 128,                    // centro server
        max_allow_publish_topics: 1000,            // centro server
        max_disallow_publish_topics: 1000,         // centro server
        max_allow_subscribe_topics: 1000,          // centro server
        max_disallow_subscribe_topics: 1000,       // centro server
        max_block_topics: 1000,                    // centro server
        max_subscribe_topics: 1000,                // centro server
        max_presence_data_length: 1 * 1024 * 1024, // centro server
        max_tokens: 10,                            // centro server
        max_token_length: 1 * 1024 * 1024,         // centro server
        max_topic_length: 4 * 1024,                // centro server,
                                                   // mqlobber-access-control

        max_publish_data_length: 16 * 1024 * 1024, // mqlobber-access-control
        max_subscriptions: 1000,                   // mqlobber-access-control
        max_publications: 10,                      // mqlobber-access-control

        db_type: 'pouchdb',                        // authorize-jwt

        send_expires: true,                        // mqlobber
        send_size: true,                           // mqlobber
        defer_to_final_handler: true,              // mqlobber

        max_open: 1000,                            // bpmux
        max_header_size: 1 * 1024 * 1024,          // bpmux

        maxSize: 1 * 1024 * 1024,                  // frame-stream

        multi_ttl: 5 * 60 * 1000,                  // qlobber-fsq
        single_ttl: 5 * 60 * 1000,                 // qlobber-fsq

        separator: '.',                            // qlobber
        wildcard_one: '*',                         // qlobber
        wildcard_some: '#',                        // qlobber
        max_words: 100,                            // qlobber
        max_wildcard_somes: 3                      // qlobber
    }, config);
};

exports.authz_token_schema = function (config, required)
{
    const topic_pattern = get_topic_pattern(config);

	return {
        title: 'Centro authorization token schema',
		description: 'Schema for authorization tokens sent by clients to a Centro server',
        '$schema': 'http://json-schema.org/draft-07/schema#',
		type: 'object',
		required: required,
		properties: {
			exp: {
				description: 'Token expiry time (in seconds since 1970-01-01)',
				type: 'integer'
			},
			iss: {
				description: 'Token issuer',
				type: 'string',
				maxLength: config.max_issuer_length
			},
			access_control: {
				description: 'Which topics clients presenting this token can subscribe and publish to. See <a href="https://github.com/davedoesdev/mqlobber-access-control">mqlobber-access-control</a>.',
				type: 'object',
				required: ['publish', 'subscribe'],
				additionalProperties: false,
				properties: {
					publish: {
						description: 'Allowed and disallowed topics for publish requests',
						type: 'object',
						required: ['allow', 'disallow'],
						additionalProperties: false,
						properties: {
							allow: {
								description: 'Clients can publish messages to these topics',
								type: 'array',
								maxItems: config.max_allow_publish_topics,
								items: {
									description: 'Topic',
									type: 'string',
									pattern: topic_pattern
								}
							},
							disallow: {
								description: 'Clients cannot publish messages to these topics',
								type: 'array',
								maxItems: config.max_disallow_publish_topics,
								items: {
									description: 'Topic',
									type: 'string',
									pattern: topic_pattern
								}
							},
                            disallow_single: {
                                description: 'If true then clients cannot publish messages to a single subscriber',
                                type: 'boolean'
                            },
                            disallow_multi: {
                                description: 'If true then clients cannot publish messages to multiple subscribers',
                                type: 'boolean'
                            }
						}
					},
					subscribe: {
						description: 'Allowed and disallowed topics for subscribe requests',
						type: 'object',
						required: ['allow', 'disallow'],
						additionalProperties: false,
						properties: {
							allow: {
								description: 'Clients can subscribe to messages published to these topics',
								type: 'array',
								maxItems: config.max_allow_subscribe_topics,
								items: {
									description: 'Topic',
									type: 'string',
									pattern: topic_pattern
								}
							},
							disallow: {
								description: 'Clients cannot subscribe to messages published to these topics',
								type: 'array',
								maxItems: config.max_disallow_subscribe_topics,
								items: {
									description: 'Topic',
									type: 'string',
									pattern: topic_pattern
								}
							}
						}
					},
					block: {
						description: "Clients cannot receive messages published to these topics. This is useful is subscribe.allow is a superset of subscribe.disallow but you don't want messages matching (a subset of) subscribe.disallow sent to clients",
						type: 'array',
						maxItems: config.max_block_topics,
						items: {
							description: 'Topic',
							type: 'string',
							pattern: topic_pattern
						}
					}
				}
			},
			subscribe: {
				description: 'Clients presenting this token are pre-subscribed to these topics',
				type: 'object',
				maxProperties: config.max_subscribe_topics,
				additionalProperties: false,
				patternProperties: {
                    [topic_pattern]: {
                        description: 'If true then presenting clients will be sent any existing, unexpired messages that match the topic, as well as new ones',
                        type: 'boolean'
                    }
                }
			},
			ack: {
				description: 'Publish an acknowledgement message when a client presenting this token acknowledges receipt of a message. See <a href="https://github.com/davedoesdev/mqlobber#mqlobberservereventsackinfo">mqlobber</a>.',
				type: 'object',
				required: ['prefix'],
				additionalProperties: false,
				properties: {
					prefix: {
						description: "The acknowledgement message's topic will be the original message's topic appended to this prefix. The body will be empty",
						type: 'string',
						pattern: topic_pattern
					}
				}
			},
			presence: {
				description: 'Publish a presence message when a client presenting this token connects or disconnects',
				type: 'object',
				required: ['connect', 'disconnect'],
				additionalProperties: false,
				properties: {
					connect: {
						description: 'Describes the message to publish when a client connects',
						type: 'object',
						required: ['topic'],
						additionalProperties: false,
						properties: {
							topic: {
								description: 'Message topic',
								type: 'string',
								pattern: topic_pattern
							},
							single: {
								description: 'Whether the message will be given to at most one interested client',
								type: 'boolean'
							},
							ttl: {
								description: 'Time-to-live (in seconds) for the message',
								type: 'integer',
								minimum: 0
							},
							data: {
								description: 'Message body',
								type: 'string',
								maxLength: config.max_presence_data_length
							}
						}
					},
					disconnect: {
						description: 'Describes the message to publish when a client disconnects',
						type: 'object',
						required: ['topic'],
						additionalProperties: false,
						properties: {
							topic: {
								description: 'Message topic',
								type: 'string',
								pattern: topic_pattern
							},
							single: {
								description: 'Whether the message will be given to at most one interested client',
								type: 'boolean'
							},
							ttl: {
								description: 'Time-to-live (in seconds) for the message',
								type: 'integer',
								minimum: 0
							},
							data: {
								description: 'Message body',
								type: 'string',
								maxLength: config.max_presence_data_length
							}
						}
					}
				}
			}
		}
    };
};

exports.default_authz_token_schema =
    exports.authz_token_schema(exports.config_with_defaults());
