# Untitled object in Centro authorization token schema Schema

```txt
https://davedoesdev.com/schemas/centro.json#/properties/access_control
```

Which topics clients presenting this token can subscribe and publish to. See <a href="https://github.com/davedoesdev/mqlobber-access-control">mqlobber-access-control</a>.


| Abstract            | Extensible | Status         | Identifiable | Custom Properties | Additional Properties | Access Restrictions | Defined In                                                                                  |
| :------------------ | ---------- | -------------- | ------------ | :---------------- | --------------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| Can be instantiated | No         | Unknown status | No           | Forbidden         | Forbidden             | none                | [default_authz_token.schema.json\*](default_authz_token.schema.json "open original schema") |

## access_control Type

`object` ([Details](default_authz_token-properties-access_control.md))

# undefined Properties

| Property                | Type     | Required | Nullable       | Defined by                                                                                                                                                                                                    |
| :---------------------- | -------- | -------- | -------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [publish](#publish)     | `object` | Required | cannot be null | [Centro authorization token schema](default_authz_token-properties-access_control-properties-publish.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/access_control/properties/publish")     |
| [subscribe](#subscribe) | `object` | Required | cannot be null | [Centro authorization token schema](default_authz_token-properties-access_control-properties-subscribe.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/access_control/properties/subscribe") |
| [block](#block)         | `array`  | Optional | cannot be null | [Centro authorization token schema](default_authz_token-properties-access_control-properties-block.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/access_control/properties/block")         |

## publish

Allowed and disallowed topics for publish requests


`publish`

-   is required
-   Type: `object` ([Details](default_authz_token-properties-access_control-properties-publish.md))
-   cannot be null
-   defined in: [Centro authorization token schema](default_authz_token-properties-access_control-properties-publish.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/access_control/properties/publish")

### publish Type

`object` ([Details](default_authz_token-properties-access_control-properties-publish.md))

## subscribe

Allowed and disallowed topics for subscribe requests


`subscribe`

-   is required
-   Type: `object` ([Details](default_authz_token-properties-access_control-properties-subscribe.md))
-   cannot be null
-   defined in: [Centro authorization token schema](default_authz_token-properties-access_control-properties-subscribe.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/access_control/properties/subscribe")

### subscribe Type

`object` ([Details](default_authz_token-properties-access_control-properties-subscribe.md))

## block

Clients cannot receive messages published to these topics. This is useful is subscribe.allow is a superset of subscribe.disallow but you don't want messages matching (a subset of) subscribe.disallow sent to clients


`block`

-   is optional
-   Type: `string[]`
-   cannot be null
-   defined in: [Centro authorization token schema](default_authz_token-properties-access_control-properties-block.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/access_control/properties/block")

### block Type

`string[]`

### block Constraints

**maximum number of items**: the maximum number of items for this array is: `1000`
