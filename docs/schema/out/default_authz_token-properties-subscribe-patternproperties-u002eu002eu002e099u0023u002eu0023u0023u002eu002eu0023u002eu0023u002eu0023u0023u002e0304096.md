# Untitled boolean in Centro authorization token schema Schema

```txt
https://davedoesdev.com/schemas/centro.json#/properties/subscribe/patternProperties/^(?=[^\u002e]*(\u002e[^\u002e]*){0,99}$)(?=([^\u0023]|((?<!(^|\u002e))\u0023)|\u0023(?!($|\u002e)))*(((?<=(^|\u002e))\u0023(?=($|\u002e)))([^\u0023]|((?<!(^|\u002e))\u0023)|\u0023(?!($|\u002e)))*){0,3}$)(?=.{0,4096}$)
```

If true then presenting clients will be sent any existing, unexpired messages that match the topic, as well as new ones


| Abstract            | Extensible | Status         | Identifiable            | Custom Properties | Additional Properties | Access Restrictions | Defined In                                                                                  |
| :------------------ | ---------- | -------------- | ----------------------- | :---------------- | --------------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| Can be instantiated | No         | Unknown status | Unknown identifiability | Forbidden         | Allowed               | none                | [default_authz_token.schema.json\*](default_authz_token.schema.json "open original schema") |

## ^(?=\[^\\u002e]\*(\\u002e\[^\\u002e]\*){0,99}$)(?=(\[^\\u0023]|((?&lt;!(^|\\u002e))\\u0023)|\\u0023(?!($|\\u002e)))\*(((?&lt;=(^|\\u002e))\\u0023(?=($|\\u002e)))(\[^\\u0023]|((?&lt;!(^|\\u002e))\\u0023)|\\u0023(?!($|\\u002e)))\*){0,3}$)(?=.{0,4096}$) Type

`boolean`
