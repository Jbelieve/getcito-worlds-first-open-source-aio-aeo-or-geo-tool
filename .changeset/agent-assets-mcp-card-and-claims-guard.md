---
"@workspace/aos-aps": patch
"@workspace/web": patch
---

Generated agent assets now declare the real MCP endpoint and the publication gate blocks regressions.

The generated bundle advertised no MCP server even when the site already
published one, and it could overwrite an existing `/.well-known` bundle with
fewer signed claims than the site served live, silently dropping trust signals.
The bundle now includes `/.well-known/mcp/server-card.json` built from the live
agent card (or the `llms.txt` endpoint) and a Web Bot Auth key directory, and
publishing is refused when the live site declares more claims than the bundle,
with a warning when it declares fewer.
