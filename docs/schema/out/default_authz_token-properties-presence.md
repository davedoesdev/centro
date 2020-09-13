# Untitled object in Centro authorization token schema Schema

```txt
https://davedoesdev.com/schemas/centro.json#/properties/presence
```

Publish a presence message when a client presenting this token connects or disconnects


| Abstract            | Extensible | Status         | Identifiable | Custom Properties | Additional Properties | Access Restrictions | Defined In                                                                                  |
| :------------------ | ---------- | -------------- | ------------ | :---------------- | --------------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| Can be instantiated | No         | Unknown status | No           | Forbidden         | Forbidden             | none                | [default_authz_token.schema.json\*](default_authz_token.schema.json "open original schema") |

## presence Type

`object` ([Details](default_authz_token-properties-presence.md))

# undefined Properties

| Property                  | Type     | Required | Nullable       | Defined by                                                                                                                                                                                          |
| :------------------------ | -------- | -------- | -------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [connect](#connect)       | `object` | Required | cannot be null | [Centro authorization token schema](default_authz_token-properties-presence-properties-connect.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/presence/properties/connect")       |
| [disconnect](#disconnect) | `object` | Required | cannot be null | [Centro authorization token schema](default_authz_token-properties-presence-properties-disconnect.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/presence/properties/disconnect") |

## connect

Describes the message to publish when a client connects


`connect`

-   is required
-   Type: `object` ([Details](default_authz_token-properties-presence-properties-connect.md))
-   cannot be null
-   defined in: [Centro authorization token schema](default_authz_token-properties-presence-properties-connect.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/presence/properties/connect")

### connect Type

`object` ([Details](default_authz_token-properties-presence-properties-connect.md))

## disconnect

Describes the message to publish when a client disconnects


`disconnect`

-   is required
-   Type: `object` ([Details](default_authz_token-properties-presence-properties-disconnect.md))
-   cannot be null
-   defined in: [Centro authorization token schema](default_authz_token-properties-presence-properties-disconnect.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/presence/properties/disconnect")

### disconnect Type

`object` ([Details](default_authz_token-properties-presence-properties-disconnect.md))
