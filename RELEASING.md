# Releasing

All `@annotatekit/*` packages are versioned together with
[Changesets](https://github.com/changesets/changesets) and published from
GitHub Actions. Nothing is ever published automatically: the release workflow
only runs when someone starts it by hand.

## Every pull request

If it changes a published package, add a changeset and commit the file it
writes to `.changeset/`:

```sh
pnpm changeset
```

CI checks every package the way npm will see it: `pnpm check:packages` packs
each one with `pnpm pack` (which applies `publishConfig` and turns
`workspace:*` into real versions), then runs [publint](https://publint.dev)
and [Are The Types Wrong](https://arethetypeswrong.github.io) on the tarball.
It also checks that the tarball has a README and LICENSE and doesn't leak the
repo-internal `@annotatekit/source` export condition.

## One-time setup

1. Create the `@annotatekit` organization on npm (or use your own scope).
2. Create an npm **automation** token with publish rights for it.
3. Add it to the GitHub repository as the `NPM_TOKEN` secret
   (Settings, Secrets and variables, Actions).

## Cutting a release

1. **Dry run.** Actions, Release, Run workflow, with "Dry run" checked (the
   default). It runs every check, prints the pending changesets and packs every
   package with `pnpm publish --dry-run`. Nothing leaves the runner.
2. **Version.** Run it again with "Dry run" unchecked. While changesets are
   pending, this opens a "Version packages" pull request that bumps versions
   and writes the changelogs. Review and merge it.
3. **Publish.** Run it once more with "Dry run" unchecked. With no changesets
   left, it builds and runs `changeset publish`: every package whose version
   isn't on npm yet is published with provenance, and a git tag is pushed for
   each.

The first release is already described in `.changeset/first-release.md` and
will be 0.1.0.
