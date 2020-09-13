# Untitled object in Centro authorization token schema Schema

```txt
https://davedoesdev.com/schemas/centro.json#/properties/access_control/properties/publish
```

Allowed and disallowed topics for publish requests


| Abstract            | Extensible | Status         | Identifiable | Custom Properties | Additional Properties | Access Restrictions | Defined In                                                                                  |
| :------------------ | ---------- | -------------- | ------------ | :---------------- | --------------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| Can be instantiated | No         | Unknown status | No           | Forbidden         | Forbidden             | none                | [default_authz_token.schema.json\*](default_authz_token.schema.json "open original schema") |

## publish Type

`object` ([Details](default_authz_token-properties-access_control-properties-publish.md))

# undefined Properties

| Property                            | Type      | Required | Nullable       | Defined by                                                                                                                                                                                                                                                      |
| :---------------------------------- | --------- | -------- | -------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [allow](#allow)                     | `array`   | Required | cannot be null | [Centro authorization token schema](default_authz_token-properties-access_control-properties-publish-properties-allow.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/access_control/properties/publish/properties/allow")                     |
| [disallow](#disallow)               | `array`   | Required | cannot be null | [Centro authorization token schema](default_authz_token-properties-access_control-properties-publish-properties-disallow.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/access_control/properties/publish/properties/disallow")               |
| [disallow_single](#disallow_single) | `boolean` | Optional | cannot be null | [Centro authorization token schema](default_authz_token-properties-access_control-properties-publish-properties-disallow_single.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/access_control/properties/publish/properties/disallow_single") |
| [disallow_multi](#disallow_multi)   | `boolean` | Optional | cannot be null | [Centro authorization token schema](default_authz_token-properties-access_control-properties-publish-properties-disallow_multi.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/access_control/properties/publish/properties/disallow_multi")   |

## allow

Clients can publish messages to these topics


`allow`

-   is required
-   Type: `string[]`
-   cannot be null
-   defined in: [Centro authorization token schema](default_authz_token-properties-access_control-properties-publish-properties-allow.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/access_control/properties/publish/properties/allow")

### allow Type

`string[]`

### allow Constraints

**maximum number of items**: the maximum number of items for this array is: `1000`

## disallow

Clients cannot publish messages to these topics


`disallow`

-   is required
-   Type: `string[]`
-   cannot be null
-   defined in: [Centro authorization token schema](default_authz_token-properties-access_control-properties-publish-properties-disallow.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/access_control/properties/publish/properties/disallow")

### disallow Type

`string[]`

### disallow Constraints

**maximum number of items**: the maximum number of items for this array is: `1000`

## disallow_single

If true then clients cannot publish messages to a single subscriber


`disallow_single`

-   is optional
-   Type: `boolean`
-   cannot be null
-   defined in: [Centro authorization token schema](default_authz_token-properties-access_control-properties-publish-properties-disallow_single.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/access_control/properties/publish/properties/disallow_single")

### disallow_single Type

`boolean`

## disallow_multi

If true then clients cannot publish messages to multiple subscribers


`disallow_multi`

-   is optional
-   Type: `boolean`
-   cannot be null
-   defined in: [Centro authorization token schema](default_authz_token-properties-access_control-properties-publish-properties-disallow_multi.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/access_control/properties/publish/properties/disallow_multi")

### disallow_multi Type

`boolean`
