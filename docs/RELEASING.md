# Releasing

1. Ensure `master` is clean and CI passes.
2. Set the release version:

```nu
npm run version:set -- 1.2.3
npm run check
```

3. Update the changelog content for the generated release heading.
4. Commit the version change.
5. Create and push a signed tag named exactly `v1.2.3`.
6. The release workflow rebuilds and verifies all assets, creates provenance
   attestations, and publishes a GitHub release.

The tag, `module.json`, `package.json`, the `-mod`, `-src` and `-doc` archives,
and the release download URL must all agree on the version.
