# Untitled object in Centro authorization token schema Schema

```txt
https://davedoesdev.com/schemas/centro.json#/properties/access_control/properties/subscribe
```

Allowed and disallowed topics for subscribe requests


| Abstract            | Extensible | Status         | Identifiable | Custom Properties | Additional Properties | Access Restrictions | Defined In                                                                                  |
| :------------------ | ---------- | -------------- | ------------ | :---------------- | --------------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| Can be instantiated | No         | Unknown status | No           | Forbidden         | Forbidden             | none                | [default_authz_token.schema.json\*](default_authz_token.schema.json "open original schema") |

## subscribe Type

`object` ([Details](default_authz_token-properties-access_control-properties-subscribe.md))

# undefined Properties

| Property              | Type    | Required | Nullable       | Defined by                                                                                                                                                                                                                                            |
| :-------------------- | ------- | -------- | -------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [allow](#allow)       | `array` | Required | cannot be null | [Centro authorization token schema](default_authz_token-properties-access_control-properties-subscribe-properties-allow.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/access_control/properties/subscribe/properties/allow")       |
| [disallow](#disallow) | `array` | Required | cannot be null | [Centro authorization token schema](default_authz_token-properties-access_control-properties-subscribe-properties-disallow.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/access_control/properties/subscribe/properties/disallow") |

## allow

Clients can subscribe to messages published to these topics


`allow`

-   is required
-   Type: `string[]`
-   cannot be null
-   defined in: [Centro authorization token schema](default_authz_token-properties-access_control-properties-subscribe-properties-allow.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/access_control/properties/subscribe/properties/allow")

### allow Type

`string[]`

### allow Constraints

**maximum number of items**: the maximum number of items for this array is: `1000`

## disallow

Clients cannot subscribe to messages published to these topics


`disallow`

-   is required
-   Type: `string[]`
-   cannot be null
-   defined in: [Centro authorization token schema](default_authz_token-properties-access_control-properties-subscribe-properties-disallow.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/access_control/properties/subscribe/properties/disallow")

### disallow Type

`string[]`

### disallow Constraints

**maximum number of items**: the maximum number of items for this array is: `1000`
