import { describe, it, expect } from 'vitest'
import { shouldFilter, isDuplicate } from '../src/capture/filter'

const DEFAULT_IGNORE = ['cd', 'ls', 'll', 'la', 'ls -la', 'ls -l', 'ls -a', 'pwd', 'clear', 'exit', 'history', 'man']

describe('shouldFilter', () => {
  describe('noise commands', () => {
    it('filters cd', () => {
      expect(shouldFilter('cd', DEFAULT_IGNORE)).toBe(true)
    })

    it('filters ls', () => {
      expect(shouldFilter('ls', DEFAULT_IGNORE)).toBe(true)
    })

    it('filters ls -la (exact ignore entry)', () => {
      expect(shouldFilter('ls -la', DEFAULT_IGNORE)).toBe(true)
    })

    it('filters pwd', () => {
      expect(shouldFilter('pwd', DEFAULT_IGNORE)).toBe(true)
    })

    it('filters clear', () => {
      expect(shouldFilter('clear', DEFAULT_IGNORE)).toBe(true)
    })

    it('filters exit', () => {
      expect(shouldFilter('exit', DEFAULT_IGNORE)).toBe(true)
    })

    it('filters history', () => {
      expect(shouldFilter('history', DEFAULT_IGNORE)).toBe(true)
    })
  })

  describe('whitespace normalisation', () => {
    it('filters ls with leading whitespace', () => {
      expect(shouldFilter('  ls  ', DEFAULT_IGNORE)).toBe(true)
    })

    it('filters ls -la with extra spaces', () => {
      expect(shouldFilter('ls  -la', DEFAULT_IGNORE)).toBe(true)
    })
  })

  describe('empty input', () => {
    it('filters empty string', () => {
      expect(shouldFilter('', DEFAULT_IGNORE)).toBe(true)
    })

    it('filters whitespace-only string', () => {
      expect(shouldFilter('   ', DEFAULT_IGNORE)).toBe(true)
    })
  })

  describe('commands that should pass through', () => {
    it('passes npm install', () => {
      expect(shouldFilter('npm install axios', DEFAULT_IGNORE)).toBe(false)
    })

    it('passes git commit', () => {
      expect(shouldFilter('git commit -m "fix"', DEFAULT_IGNORE)).toBe(false)
    })

    it('passes docker build', () => {
      expect(shouldFilter('docker build .', DEFAULT_IGNORE)).toBe(false)
    })

    it('passes ls with a path argument (not in ignore list)', () => {
      // 'ls /some/path' — base cmd 'ls' IS in the ignore list, so this IS filtered
      expect(shouldFilter('ls /some/path', DEFAULT_IGNORE)).toBe(true)
    })

    it('passes cd with a path argument', () => {
      // 'cd /home' — base cmd 'cd' IS in the ignore list, so filtered
      expect(shouldFilter('cd /home', DEFAULT_IGNORE)).toBe(true)
    })
  })

  describe('custom ignore list', () => {
    it('filters commands in a custom list', () => {
      expect(shouldFilter('htop', ['htop', 'top'])).toBe(true)
    })

    it('passes commands not in the custom list', () => {
      expect(shouldFilter('npm test', ['htop'])).toBe(false)
    })
  })
})

describe('isDuplicate', () => {
  const base = {
    command: 'npm test',
    cwd: '/projects/myapp',
    captured_at: new Date().toISOString(),
  }

  it('returns false when there is no last event', () => {
    expect(isDuplicate('npm test', '/projects/myapp', undefined)).toBe(false)
  })

  it('returns true for same command + same cwd within window', () => {
    const now = Date.now()
    const recentTime = new Date(now - 1000).toISOString() // 1 second ago
    expect(isDuplicate('npm test', '/projects/myapp', { ...base, captured_at: recentTime }, 5000, now)).toBe(true)
  })

  it('returns false when command differs', () => {
    const now = Date.now()
    const recentTime = new Date(now - 1000).toISOString()
    expect(isDuplicate('npm run build', '/projects/myapp', { ...base, captured_at: recentTime }, 5000, now)).toBe(false)
  })

  it('returns false when cwd differs', () => {
    const now = Date.now()
    const recentTime = new Date(now - 1000).toISOString()
    expect(isDuplicate('npm test', '/projects/other', { ...base, captured_at: recentTime }, 5000, now)).toBe(false)
  })

  it('returns false when outside the dedup window', () => {
    const now = Date.now()
    const oldTime = new Date(now - 10000).toISOString() // 10 seconds ago
    expect(isDuplicate('npm test', '/projects/myapp', { ...base, captured_at: oldTime }, 5000, now)).toBe(false)
  })

  it('returns true at exactly 1ms before window closes', () => {
    const now = Date.now()
    const edgeTime = new Date(now - 4999).toISOString()
    expect(isDuplicate('npm test', '/projects/myapp', { ...base, captured_at: edgeTime }, 5000, now)).toBe(true)
  })

  it('returns false at exactly the window boundary', () => {
    const now = Date.now()
    const edgeTime = new Date(now - 5000).toISOString()
    expect(isDuplicate('npm test', '/projects/myapp', { ...base, captured_at: edgeTime }, 5000, now)).toBe(false)
  })

  it('normalizes whitespace before comparing', () => {
    const now = Date.now()
    const recentTime = new Date(now - 1000).toISOString()
    // last event has 'npm test', new command has extra spaces
    expect(isDuplicate('npm  test', '/projects/myapp', { ...base, captured_at: recentTime }, 5000, now)).toBe(true)
  })
})
