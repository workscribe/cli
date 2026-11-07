#!/usr/bin/env node
'use strict'

// Stands in for `workscribe _hook` during a capture run (see tests/fixtures/agent-hooks/README.md): it records what an
// agent sends and never touches Workscribe. Usage in a hook command:
//   WORKSCRIBE_CAPTURE_DIR=<scratch folder> node record-hook.js <hook event>

const fs = require('fs')
const path = require('path')

const STDIN_FILE_DESCRIPTOR = 0
// Antigravity requires `decision` on Stop; every other event it's registered on accepts an empty object
const STOP_OUTPUT = JSON.stringify({ decision: 'allow' })
const DEFAULT_OUTPUT = JSON.stringify({})

function outputFor(hookEvent) {
  return hookEvent === 'Stop' ? STOP_OUTPUT : DEFAULT_OUTPUT
}

/** A payload that isn't JSON is a finding too, so it's kept as text. */
function parsePayload(rawPayload) {
  try {
    return JSON.parse(rawPayload)
  } catch {
    return rawPayload
  }
}

function buildRecording({ hookEvent, rawPayload }) {
  return {
    hookEvent,
    recordedAt: new Date().toISOString(),
    hookWorkingFolder: process.cwd(),
    argv: process.argv.slice(2),
    // Names only: the values can hold credentials, and the names are enough to tell one host from another
    environmentVariableNames: Object.keys(process.env).sort(),
    payload: parsePayload(rawPayload),
  }
}

function writeRecording({ captureDirectory, hookEvent }) {
  const rawPayload = fs.readFileSync(STDIN_FILE_DESCRIPTOR, 'utf8')
  const fileName = `${Date.now()}-${process.pid}-${hookEvent}.json`
  const recording = buildRecording({ hookEvent, rawPayload })
  fs.writeFileSync(path.join(captureDirectory, fileName), `${JSON.stringify(recording, null, 2)}\n`)
}

function main() {
  const hookEvent = process.argv[2] ?? 'unknown'
  try {
    writeRecording({ captureDirectory: process.env.WORKSCRIBE_CAPTURE_DIR, hookEvent })
  } catch (error) {
    // A recorder that fails must not disturb the agent. No recording means the run doesn't count
    console.error(`record-hook: ${error.message}`)
  }
  process.stdout.write(outputFor(hookEvent))
}

main()
