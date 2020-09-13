# Untitled array in Centro authorization token schema Schema

```txt
https://davedoesdev.com/schemas/centro.json#/properties/access_control/properties/block
```

Clients cannot receive messages published to these topics. This is useful is subscribe.allow is a superset of subscribe.disallow but you don't want messages matching (a subset of) subscribe.disallow sent to clients


| Abstract            | Extensible | Status         | Identifiable            | Custom Properties | Additional Properties | Access Restrictions | Defined In                                                                                  |
| :------------------ | ---------- | -------------- | ----------------------- | :---------------- | --------------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| Can be instantiated | No         | Unknown status | Unknown identifiability | Forbidden         | Allowed               | none                | [default_authz_token.schema.json\*](default_authz_token.schema.json "open original schema") |

## block Type

`string[]`

## block Constraints

**maximum number of items**: the maximum number of items for this array is: `1000`
