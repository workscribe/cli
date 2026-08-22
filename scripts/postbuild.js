#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const dist = path.resolve(__dirname, '..', 'dist', 'index.js')
let content = fs.readFileSync(dist, 'utf8')

// tsup strips `node:` prefix from built-in requires — restore it
content = content.replace('require("sqlite")', 'require("node:sqlite")')

// Suppress the Node 22 ExperimentalWarning for SQLite
content = content.replace(
  '#!/usr/bin/env node',
  '#!/usr/bin/env -S node --disable-warning=ExperimentalWarning'
)

fs.writeFileSync(dist, content)
fs.chmodSync(dist, 0o755)
