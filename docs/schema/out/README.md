# README

## Top-level Schemas

-   [Centro authorization token schema](./default_authz_token.md "Schema for authorization tokens sent by clients to a Centro server") – `https://davedoesdev.com/schemas/centro.json`

## Other Schemas

### Objects

-   [Untitled object in Centro authorization token schema](./default_authz_token-properties-access_control.md "Which topics clients presenting this token can subscribe and publish to") – `https://davedoesdev.com/schemas/centro.json#/properties/access_control`
-   [Untitled object in Centro authorization token schema](./default_authz_token-properties-access_control-properties-publish.md "Allowed and disallowed topics for publish requests") – `https://davedoesdev.com/schemas/centro.json#/properties/access_control/properties/publish`
-   [Untitled object in Centro authorization token schema](./default_authz_token-properties-access_control-properties-subscribe.md "Allowed and disallowed topics for subscribe requests") – `https://davedoesdev.com/schemas/centro.json#/properties/access_control/properties/subscribe`
-   [Untitled object in Centro authorization token schema](./default_authz_token-properties-subscribe.md "Clients presenting this token are pre-subscribed to these topics") – `https://davedoesdev.com/schemas/centro.json#/properties/subscribe`
-   [Untitled object in Centro authorization token schema](./default_authz_token-properties-ack.md "Publish an acknowledgement message when a client presenting this token acknowledges receipt of a message") – `https://davedoesdev.com/schemas/centro.json#/properties/ack`
-   [Untitled object in Centro authorization token schema](./default_authz_token-properties-presence.md "Publish a presence message when a client presenting this token connects or disconnects") – `https://davedoesdev.com/schemas/centro.json#/properties/presence`
-   [Untitled object in Centro authorization token schema](./default_authz_token-properties-presence-properties-connect.md "Describes the message to publish when a client connects") – `https://davedoesdev.com/schemas/centro.json#/properties/presence/properties/connect`
-   [Untitled object in Centro authorization token schema](./default_authz_token-properties-presence-properties-disconnect.md "Describes the message to publish when a client disconnects") – `https://davedoesdev.com/schemas/centro.json#/properties/presence/properties/disconnect`

### Arrays

-   [Untitled array in Centro authorization token schema](./default_authz_token-properties-access_control-properties-publish-properties-allow.md "Clients can publish messages to these topics") – `https://davedoesdev.com/schemas/centro.json#/properties/access_control/properties/publish/properties/allow`
-   [Untitled array in Centro authorization token schema](./default_authz_token-properties-access_control-properties-publish-properties-disallow.md "Clients cannot publish messages to these topics") – `https://davedoesdev.com/schemas/centro.json#/properties/access_control/properties/publish/properties/disallow`
-   [Untitled array in Centro authorization token schema](./default_authz_token-properties-access_control-properties-subscribe-properties-allow.md "Clients can subscribe to messages published to these topics") – `https://davedoesdev.com/schemas/centro.json#/properties/access_control/properties/subscribe/properties/allow`
-   [Untitled array in Centro authorization token schema](./default_authz_token-properties-access_control-properties-subscribe-properties-disallow.md "Clients cannot subscribe to messages published to these topics") – `https://davedoesdev.com/schemas/centro.json#/properties/access_control/properties/subscribe/properties/disallow`
-   [Untitled array in Centro authorization token schema](./default_authz_token-properties-access_control-properties-block.md "Clients cannot receive messages published to these topics") – `https://davedoesdev.com/schemas/centro.json#/properties/access_control/properties/block`

## Version Note

The schemas linked above follow the JSON Schema Spec version: `http://json-schema.org/draft-07/schema#`
