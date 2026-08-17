import { describe, it, expect, vi, beforeEach } from 'vitest'
import { assertNodeVersion } from '../src/utils/node-version'

beforeEach(() => {
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

describe('assertNodeVersion', () => {
  it('does nothing on Node 22', () => {
    assertNodeVersion('22.0.0')
    expect(process.exit).not.toHaveBeenCalled()
  })

  it('does nothing on Node 23', () => {
    assertNodeVersion('23.1.0')
    expect(process.exit).not.toHaveBeenCalled()
  })

  it('exits with code 1 on Node 20', () => {
    assertNodeVersion('20.11.0')
    expect(process.exit).toHaveBeenCalledWith(1)
  })

  it('exits with code 1 on Node 18', () => {
    assertNodeVersion('18.20.0')
    expect(process.exit).toHaveBeenCalledWith(1)
  })

  it('includes the actual version in the error message', () => {
    assertNodeVersion('18.20.0')
    const output = (process.stderr.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(output).toContain('v18.20.0')
  })

  it('mentions Node 22 as the minimum required version', () => {
    assertNodeVersion('20.0.0')
    const output = (process.stderr.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(output).toContain('Node.js 22 or later')
  })

  it('includes an actionable nvm upgrade command', () => {
    assertNodeVersion('20.0.0')
    const output = (process.stderr.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(output).toContain('nvm install 22')
  })
})
