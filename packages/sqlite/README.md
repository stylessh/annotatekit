# @annotatekit/sqlite

A SQLite `StorageAdapter` for AnnotateKit. It uses Node's built-in `node:sqlite`
(Node 22.13+), so there is nothing native to install, and it also accepts an
open `better-sqlite3` or `bun:sqlite` database.

```ts
import { createAnnotateKitService } from "@annotatekit/core";
import { createSqliteStorage } from "@annotatekit/sqlite";

const storage = createSqliteStorage({ database: "./annotatekit.db" });
const service = createAnnotateKitService({ storage });
```

Options:

| Option        | Default    | Notes                                                            |
| ------------- | ---------- | ---------------------------------------------------------------- |
| `database`    | `:memory:` | A file path, `:memory:`, or an open database object              |
| `tablePrefix` | `ak_`      | Prefix for table names, to share a database with your own tables |

Each entity is stored as JSON, with the fields queries filter on (project,
status, page URL, pathname, group, author, timestamps) copied into indexed
columns. Files are opened in WAL mode. The schema version is kept in
`<prefix>meta` and migrated on open.

`subscribe` reports changes made through the same adapter instance. Run one
server process per database file if you need live updates for every client.

The adapter passes the shared storage contract suite in
`packages/core/test/storage-contract.ts`.
