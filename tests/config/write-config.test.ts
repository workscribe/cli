import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'

const configFolder = vi.hoisted(() => `${process.env.TMPDIR ?? '/tmp'}/write-config-${process.pid}`)

vi.mock('../../src/utils/paths', () => ({ CONFIG_PATH: `${configFolder}/config.json` }))

import { readConfig, writeConfig } from '../../src/config'
import { createTestConfig } from '../helpers/config'

const CONFIG_PATH = `${configFolder}/config.json`

beforeEach(() => {
  fs.rmSync(configFolder, { recursive: true, force: true })
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(configFolder, { recursive: true, force: true })
})

describe('writeConfig', () => {
  it('saves a config that reads back, with the excluded folders', () => {
    const config = createTestConfig()
    writeConfig({ ...config, capture: { ...config.capture, excludePaths: ['/work/client'] } })

    expect(readConfig().capture.excludePaths).toEqual(['/work/client'])
  })

  it('writes a file beside the config and renames it over, never writing the config in place', () => {
    const writeSpy = vi.spyOn(fs, 'writeFileSync')
    const renameSpy = vi.spyOn(fs, 'renameSync')

    writeConfig(createTestConfig())

    const writtenPath = String(writeSpy.mock.calls[0][0])
    expect(writtenPath).not.toBe(CONFIG_PATH)
    expect(path.dirname(writtenPath)).toBe(path.dirname(CONFIG_PATH))
    expect(renameSpy).toHaveBeenCalledWith(writtenPath, CONFIG_PATH)
  })

  it('leaves no temporary file behind, and keeps the config private', () => {
    writeConfig(createTestConfig())

    expect(fs.readdirSync(configFolder)).toEqual(['config.json'])
    expect(fs.statSync(CONFIG_PATH).mode & 0o777).toBe(0o600)
  })

  it('keeps the old config when the new one cannot be written', () => {
    const config = createTestConfig()
    writeConfig({ ...config, capture: { ...config.capture, excludePaths: ['/work/client'] } })
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('disk full')
    })

    expect(() => writeConfig(createTestConfig())).toThrow('disk full')
    expect(readConfig().capture.excludePaths).toEqual(['/work/client'])
  })
})
