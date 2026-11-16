# Security model

- GitHub Actions are pinned to full commit SHAs.
- Workflows use explicit least-privilege permissions.
- Release artifacts receive SHA-256 checksums and provenance attestations.
- Install archives exclude tests, source maps, credentials, caches, and
  repository metadata.
- Source archives exclude credentials and generated dependency trees.
- Imported JSON and complementary-module registrations must be validated.
- Diagnostics must not expose hidden document text, secrets, or private player
  data.
- Optional dependencies must fail safely and must not silently reveal protected
  content.
