// This file must import nothing beyond assertNodeVersion. ES import
// statements are hoisted and execute before any of a module's own top-level
// code, regardless of source order — so `import`-ing anything that
// transitively loads node:sqlite (e.g. src/cli/capture.ts -> src/db/index.ts)
// would load and crash on Node < 22 before assertNodeVersion ever runs.
// require() is not hoisted, so the rest of the CLI is only loaded after the
// version check passes.
import { assertNodeVersion } from './utils/node-version'

assertNodeVersion(process.versions.node)

// eslint-disable-next-line @typescript-eslint/no-require-imports -- must not be a static import (see file comment above)
require('./main')
