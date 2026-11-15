# Changesets

Every pull request that changes a published package should add a changeset:

```sh
pnpm changeset
```

Pick the packages, the bump (patch, minor or major) and write one line for the
changelog. All `@annotatekit/*` packages are released together at one version
(the `fixed` group in `config.json`). See [RELEASING.md](../RELEASING.md) for
how a release goes out.
