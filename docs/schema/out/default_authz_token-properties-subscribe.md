# Untitled object in Centro authorization token schema Schema

```txt
https://davedoesdev.com/schemas/centro.json#/properties/subscribe
```

Clients presenting this token are pre-subscribed to these topics


| Abstract            | Extensible | Status         | Identifiable            | Custom Properties | Additional Properties | Access Restrictions | Defined In                                                                                  |
| :------------------ | ---------- | -------------- | ----------------------- | :---------------- | --------------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| Can be instantiated | No         | Unknown status | Unknown identifiability | Forbidden         | Forbidden             | none                | [default_authz_token.schema.json\*](default_authz_token.schema.json "open original schema") |

## subscribe Type

`object` ([Details](default_authz_token-properties-subscribe.md))

## subscribe Constraints

**maximum number of properties**: the maximum number of properties for this object is: `1000`

# undefined Properties

| Property                                                                                                                                                                                                                    | Type      | Required | Nullable       | Defined by                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------- | -------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `^(?=[^\u002e]*(\u002e[^\u002e]*){0,99}$)(?=([^\u0023]|((?<!(^|\u002e))\u0023)|\u0023(?!($|\u002e)))*(((?<=(^|\u002e))\u0023(?=($|\u002e)))([^\u0023]|((?<!(^|\u002e))\u0023)|\u0023(?!($|\u002e)))*){0,3}$)(?=.{0,4096}$)` | `boolean` | Optional | cannot be null | [Centro authorization token schema](default_authz_token-properties-subscribe-patternproperties-u002eu002eu002e099u0023u002eu0023u0023u002eu002eu0023u002eu0023u002eu0023u0023u002e0304096.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/subscribe/patternProperties/^(?=\[^\\u002e]\*(\\u002e\[^\\u002e]\*){0,99}$)(?=(\[^\\u0023]\|((?&lt;!(^\|\\u002e))\\u0023)\|\\u0023(?!($\|\\u002e)))\*(((?&lt;=(^\|\\u002e))\\u0023(?=($\|\\u002e)))(\[^\\u0023]\|((?&lt;!(^\|\\u002e))\\u0023)\|\\u0023(?!($\|\\u002e)))\*){0,3}$)(?=.{0,4096}$)") |

## Pattern: `^(?=[^\u002e]*(\u002e[^\u002e]*){0,99}$)(?=([^\u0023]|((?<!(^|\u002e))\u0023)|\u0023(?!($|\u002e)))*(((?<=(^|\u002e))\u0023(?=($|\u002e)))([^\u0023]|((?<!(^|\u002e))\u0023)|\u0023(?!($|\u002e)))*){0,3}$)(?=.{0,4096}$)`

If true then presenting clients will be sent any existing, unexpired messages that match the topic, as well as new ones


`^(?=[^\u002e]*(\u002e[^\u002e]*){0,99}$)(?=([^\u0023]|((?<!(^|\u002e))\u0023)|\u0023(?!($|\u002e)))*(((?<=(^|\u002e))\u0023(?=($|\u002e)))([^\u0023]|((?<!(^|\u002e))\u0023)|\u0023(?!($|\u002e)))*){0,3}$)(?=.{0,4096}$)`

-   is optional
-   Type: `boolean`
-   cannot be null
-   defined in: [Centro authorization token schema](default_authz_token-properties-subscribe-patternproperties-u002eu002eu002e099u0023u002eu0023u0023u002eu002eu0023u002eu0023u002eu0023u0023u002e0304096.md "https&#x3A;//davedoesdev.com/schemas/centro.json#/properties/subscribe/patternProperties/^(?=\[^\\u002e]\*(\\u002e\[^\\u002e]\*){0,99}$)(?=(\[^\\u0023]|((?&lt;!(^|\\u002e))\\u0023)|\\u0023(?!($|\\u002e)))\*(((?&lt;=(^|\\u002e))\\u0023(?=($|\\u002e)))(\[^\\u0023]|((?&lt;!(^|\\u002e))\\u0023)|\\u0023(?!($|\\u002e)))\*){0,3}$)(?=.{0,4096}$)")

### ^(?=\[^\\u002e]\*(\\u002e\[^\\u002e]\*){0,99}$)(?=(\[^\\u0023]|((?&lt;!(^|\\u002e))\\u0023)|\\u0023(?!($|\\u002e)))\*(((?&lt;=(^|\\u002e))\\u0023(?=($|\\u002e)))(\[^\\u0023]|((?&lt;!(^|\\u002e))\\u0023)|\\u0023(?!($|\\u002e)))\*){0,3}$)(?=.{0,4096}$) Type

`boolean`
