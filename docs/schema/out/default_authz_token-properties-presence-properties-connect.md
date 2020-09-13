# Untitled object in Centro authorization token schema Schema

```txt
https://davedoesdev.com/schemas/centro.json#/properties/presence/properties/connect
```

Describes the message to publish when a client connects


| Abstract            | Extensible | Status         | Identifiable | Custom Properties | Additional Properties | Access Restrictions | Defined In                                                                                  |
| :------------------ | ---------- | -------------- | ------------ | :---------------- | --------------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| Can be instantiated | No         | Unknown status | No           | Forbidden         | Forbidden             | none                | [default_authz_token.schema.json\*](default_authz_token.schema.json "open original schema") |

## connect Type

`object` ([Details](default_authz_token-properties-presence-properties-connect.md))

# undefined Properties

| Property          | Type      | Required | Nullable       | Defined by                                                                                                                                                                                                                        |
| :---------------- | --------- | -------- | -------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [topic](#topic)   | `string`  | Required | cannot be null | [Centro authorization token schema](default_authz_token-properties-presence-properties-connect-properties-topic.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/presence/properties/connect/properties/topic")   |
| [single](#single) | `boolean` | Optional | cannot be null | [Centro authorization token schema](default_authz_token-properties-presence-properties-connect-properties-single.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/presence/properties/connect/properties/single") |
| [ttl](#ttl)       | `integer` | Optional | cannot be null | [Centro authorization token schema](default_authz_token-properties-presence-properties-connect-properties-ttl.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/presence/properties/connect/properties/ttl")       |
| [data](#data)     | `string`  | Optional | cannot be null | [Centro authorization token schema](default_authz_token-properties-presence-properties-connect-properties-data.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/presence/properties/connect/properties/data")     |

## topic

Message topic


`topic`

-   is required
-   Type: `string`
-   cannot be null
-   defined in: [Centro authorization token schema](default_authz_token-properties-presence-properties-connect-properties-topic.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/presence/properties/connect/properties/topic")

### topic Type

`string`

### topic Constraints

**pattern**: the string must match the following regular expression: 

```regexp
^(?=[^\u002e]*(\u002e[^\u002e]*){0,99}$)(?=([^\u0023]|((?<!(^|\u002e))\u0023)|\u0023(?!($|\u002e)))*(((?<=(^|\u002e))\u0023(?=($|\u002e)))([^\u0023]|((?<!(^|\u002e))\u0023)|\u0023(?!($|\u002e)))*){0,3}$)(?=.{0,4096}$)
```

[try pattern](https://regexr.com/?expression=%5E(%3F%3D%5B%5E%5Cu002e%5D*(%5Cu002e%5B%5E%5Cu002e%5D*)%7B0%2C99%7D%24)(%3F%3D(%5B%5E%5Cu0023%5D%7C((%3F%3C!(%5E%7C%5Cu002e))%5Cu0023)%7C%5Cu0023(%3F!(%24%7C%5Cu002e)))*(((%3F%3C%3D(%5E%7C%5Cu002e))%5Cu0023(%3F%3D(%24%7C%5Cu002e)))(%5B%5E%5Cu0023%5D%7C((%3F%3C!(%5E%7C%5Cu002e))%5Cu0023)%7C%5Cu0023(%3F!(%24%7C%5Cu002e)))*)%7B0%2C3%7D%24)(%3F%3D.%7B0%2C4096%7D%24) "try regular expression with regexr.com")

## single

Whether the message will be given to at most one interested client


`single`

-   is optional
-   Type: `boolean`
-   cannot be null
-   defined in: [Centro authorization token schema](default_authz_token-properties-presence-properties-connect-properties-single.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/presence/properties/connect/properties/single")

### single Type

`boolean`

## ttl

Time-to-live (in seconds) for the message


`ttl`

-   is optional
-   Type: `integer`
-   cannot be null
-   defined in: [Centro authorization token schema](default_authz_token-properties-presence-properties-connect-properties-ttl.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/presence/properties/connect/properties/ttl")

### ttl Type

`integer`

### ttl Constraints

**minimum**: the value of this number must greater than or equal to: `0`

## data

Message body


`data`

-   is optional
-   Type: `string`
-   cannot be null
-   defined in: [Centro authorization token schema](default_authz_token-properties-presence-properties-connect-properties-data.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/presence/properties/connect/properties/data")

### data Type

`string`

### data Constraints

**maximum length**: the maximum number of characters for this string is: `1048576`
