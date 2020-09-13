# Centro authorization token schema Schema

```txt
https://davedoesdev.com/schemas/centro.json
```

Schema for authorization tokens sent by clients to a Centro server


| Abstract            | Extensible | Status         | Identifiable | Custom Properties | Additional Properties | Access Restrictions | Defined In                                                                                |
| :------------------ | ---------- | -------------- | ------------ | :---------------- | --------------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| Can be instantiated | No         | Unknown status | No           | Forbidden         | Allowed               | none                | [default_authz_token.schema.json](default_authz_token.schema.json "open original schema") |

## Centro authorization token schema Type

`object` ([Centro authorization token schema](default_authz_token.md))

# Centro authorization token schema Properties

| Property                          | Type      | Required | Nullable       | Defined by                                                                                                                                                          |
| :-------------------------------- | --------- | -------- | -------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [exp](#exp)                       | `integer` | Optional | cannot be null | [Centro authorization token schema](default_authz_token-properties-exp.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/exp")                       |
| [iss](#iss)                       | `string`  | Optional | cannot be null | [Centro authorization token schema](default_authz_token-properties-iss.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/iss")                       |
| [access_control](#access_control) | `object`  | Optional | cannot be null | [Centro authorization token schema](default_authz_token-properties-access_control.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/access_control") |
| [subscribe](#subscribe)           | `object`  | Optional | cannot be null | [Centro authorization token schema](default_authz_token-properties-subscribe.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/subscribe")           |
| [ack](#ack)                       | `object`  | Optional | cannot be null | [Centro authorization token schema](default_authz_token-properties-ack.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/ack")                       |
| [presence](#presence)             | `object`  | Optional | cannot be null | [Centro authorization token schema](default_authz_token-properties-presence.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/presence")             |

## exp

Token expiry time (in seconds since 1970-01-01)


`exp`

-   is optional
-   Type: `integer`
-   cannot be null
-   defined in: [Centro authorization token schema](default_authz_token-properties-exp.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/exp")

### exp Type

`integer`

## iss

Token issuer


`iss`

-   is optional
-   Type: `string`
-   cannot be null
-   defined in: [Centro authorization token schema](default_authz_token-properties-iss.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/iss")

### iss Type

`string`

### iss Constraints

**maximum length**: the maximum number of characters for this string is: `128`

## access_control

Which topics clients presenting this token can subscribe and publish to. See <a href="https://github.com/davedoesdev/mqlobber-access-control">mqlobber-access-control</a>.


`access_control`

-   is optional
-   Type: `object` ([Details](default_authz_token-properties-access_control.md))
-   cannot be null
-   defined in: [Centro authorization token schema](default_authz_token-properties-access_control.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/access_control")

### access_control Type

`object` ([Details](default_authz_token-properties-access_control.md))

## subscribe

Clients presenting this token are pre-subscribed to these topics


`subscribe`

-   is optional
-   Type: `object` ([Details](default_authz_token-properties-subscribe.md))
-   cannot be null
-   defined in: [Centro authorization token schema](default_authz_token-properties-subscribe.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/subscribe")

### subscribe Type

`object` ([Details](default_authz_token-properties-subscribe.md))

### subscribe Constraints

**maximum number of properties**: the maximum number of properties for this object is: `1000`

## ack

Publish an acknowledgement message when a client presenting this token acknowledges receipt of a message. See <a href="https://github.com/davedoesdev/mqlobber#mqlobberservereventsackinfo">mqlobber</a>.


`ack`

-   is optional
-   Type: `object` ([Details](default_authz_token-properties-ack.md))
-   cannot be null
-   defined in: [Centro authorization token schema](default_authz_token-properties-ack.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/ack")

### ack Type

`object` ([Details](default_authz_token-properties-ack.md))

## presence

Publish a presence message when a client presenting this token connects or disconnects


`presence`

-   is optional
-   Type: `object` ([Details](default_authz_token-properties-presence.md))
-   cannot be null
-   defined in: [Centro authorization token schema](default_authz_token-properties-presence.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/presence")

### presence Type

`object` ([Details](default_authz_token-properties-presence.md))
