---

"@annotatekit/auth": minor
"@annotatekit/core": minor
---

Commenters can mint keys for their own agents by default (`createApiKeyHandler` now defaults `mintScope` to `annotations:write`; set `project:admin` to keep it to admins), and an agent acting on someone's behalf owns what that person authored, so it can pick up and close their threads without gaining any role they lack.
