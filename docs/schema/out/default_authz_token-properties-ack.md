# Untitled object in Centro authorization token schema Schema

```txt
https://davedoesdev.com/schemas/centro.json#/properties/ack
```

Publish an acknowledgement message when a client presenting this token acknowledges receipt of a message. See <a href="https://github.com/davedoesdev/mqlobber#mqlobberservereventsackinfo">mqlobber</a>.


| Abstract            | Extensible | Status         | Identifiable | Custom Properties | Additional Properties | Access Restrictions | Defined In                                                                                  |
| :------------------ | ---------- | -------------- | ------------ | :---------------- | --------------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| Can be instantiated | No         | Unknown status | No           | Forbidden         | Forbidden             | none                | [default_authz_token.schema.json\*](default_authz_token.schema.json "open original schema") |

## ack Type

`object` ([Details](default_authz_token-properties-ack.md))

# undefined Properties

| Property          | Type     | Required | Nullable       | Defined by                                                                                                                                                                        |
| :---------------- | -------- | -------- | -------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [prefix](#prefix) | `string` | Required | cannot be null | [Centro authorization token schema](default_authz_token-properties-ack-properties-prefix.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/ack/properties/prefix") |

## prefix

The acknowledgement message's topic will be the original message's topic appended to this prefix. The body will be empty


`prefix`

-   is required
-   Type: `string`
-   cannot be null
-   defined in: [Centro authorization token schema](default_authz_token-properties-ack-properties-prefix.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/ack/properties/prefix")

### prefix Type

`string`

### prefix Constraints

**pattern**: the string must match the following regular expression: 

```regexp
^(?=[^\u002e]*(\u002e[^\u002e]*){0,99}$)(?=([^\u0023]|((?<!(^|\u002e))\u0023)|\u0023(?!($|\u002e)))*(((?<=(^|\u002e))\u0023(?=($|\u002e)))([^\u0023]|((?<!(^|\u002e))\u0023)|\u0023(?!($|\u002e)))*){0,3}$)(?=.{0,4096}$)
```

[try pattern](https://regexr.com/?expression=%5E(%3F%3D%5B%5E%5Cu002e%5D*(%5Cu002e%5B%5E%5Cu002e%5D*)%7B0%2C99%7D%24)(%3F%3D(%5B%5E%5Cu0023%5D%7C((%3F%3C!(%5E%7C%5Cu002e))%5Cu0023)%7C%5Cu0023(%3F!(%24%7C%5Cu002e)))*(((%3F%3C%3D(%5E%7C%5Cu002e))%5Cu0023(%3F%3D(%24%7C%5Cu002e)))(%5B%5E%5Cu0023%5D%7C((%3F%3C!(%5E%7C%5Cu002e))%5Cu0023)%7C%5Cu0023(%3F!(%24%7C%5Cu002e)))*)%7B0%2C3%7D%24)(%3F%3D.%7B0%2C4096%7D%24) "try regular expression with regexr.com")
