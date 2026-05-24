# Releasing Chronicle

## Prerequisites

- Logged in to npm: `npm whoami` (if not, run `npm login`)
- GitHub token with `repo` scope set as `GITHUB_TOKEN` environment variable
- Clean working directory with all changes committed and pushed

## Making a release

### 1. Dry run first (always)

```bash
npm run release:dry
```

This shows exactly what will happen — version bump, changelog entries, git tag — without making any changes.

### 2. Release

```bash
npm run release
```

release-it will:
1. Determine the version bump from commits since the last tag (`feat` → minor, `fix` → patch, `feat!` → major)
2. Update `package.json` version
3. Generate changelog entries in `CHANGELOG.md`
4. Commit both files with `chore: release vX.Y.Z`
5. Create and push a git tag `vX.Y.Z`
6. Create a GitHub release with the changelog as the body
7. Publish to npm under `@workscribe/cli`

You'll be prompted to confirm before each step.

### 3. Set the GitHub token

release-it needs a GitHub token to create releases:

```bash
export GITHUB_TOKEN=<your-token>
```

Generate one at: GitHub → Settings → Developer settings → Personal access tokens → with `repo` scope.

Add it to your shell profile so it persists:
```bash
echo 'export GITHUB_TOKEN=<your-token>' >> ~/.zshrc
```

## Commit message format

Commits drive automatic versioning — use conventional commits:

| Prefix | Effect | Example |
|---|---|---|
| `fix:` | patch bump (0.1.0 → 0.1.1) | `fix: redact pattern not resetting` |
| `feat:` | minor bump (0.1.0 → 0.2.0) | `feat: add fish shell support` |
| `feat!:` or `BREAKING CHANGE:` | major bump (0.1.0 → 1.0.0) | `feat!: rename config keys` |
| `docs:`, `chore:`, `test:` | no bump | `docs: update README` |

## First-time npm publish

Before the first release, ensure:

1. You are a member of the `@workscribe` npm org
2. Run `npm login` and authenticate
3. Verify access: `npm org ls workscribe`
