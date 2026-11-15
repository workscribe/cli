import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { readJsonConfig, writeJsonConfig } from '../../src/capture/hooks/config-file'

let folder: string
let file: string

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-config-'))
  file = path.join(folder, 'agent', 'settings.json')
})

afterEach(() => {
  fs.rmSync(folder, { recursive: true, force: true })
})

const backups = () => fs.readdirSync(path.dirname(file)).filter((name) => name.includes('workscribe-backup'))

describe('readJsonConfig', () => {
  it('tells a missing file, an unreadable one and an object apart', () => {
    expect(readJsonConfig(file)).toEqual({ kind: 'missing' })

    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '{ not json')
    expect(readJsonConfig(file)).toEqual({ kind: 'unreadable' })

    fs.writeFileSync(file, '[1, 2]')
    expect(readJsonConfig(file)).toEqual({ kind: 'unreadable' })

    fs.writeFileSync(file, '{"hooks": {}}')
    expect(readJsonConfig(file)).toEqual({ kind: 'ok', value: { hooks: {} } })
  })
})

describe('writeJsonConfig', () => {
  it('creates the folder and file when there is none, with nothing to back up', () => {
    writeJsonConfig(file, { a: 1 })

    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({ a: 1 })
    expect(backups()).toEqual([])
  })

  it('does nothing when the file would stay as it is, so running init again leaves no extra backup', () => {
    writeJsonConfig(file, { a: 1 })

    writeJsonConfig(file, { a: 1 })
    writeJsonConfig(file, { a: 1 })

    expect(backups()).toEqual([])
  })

  it('backs the existing file up before replacing it', () => {
    writeJsonConfig(file, { a: 1 })

    writeJsonConfig(file, { a: 2 })

    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({ a: 2 })
    const [backup] = backups()
    expect(JSON.parse(fs.readFileSync(path.join(path.dirname(file), backup), 'utf-8'))).toEqual({ a: 1 })
  })
})
