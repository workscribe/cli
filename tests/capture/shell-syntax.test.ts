import { describe, it, expect } from 'vitest'
import { containsCommandSubstitution, isOutsideQuotes, splitOutsideQuotes } from '../../src/capture/shell-syntax'

describe('splitOutsideQuotes', () => {
  it('ignores separators inside quotes and escaped quotes', () => {
    expect(splitOutsideQuotes(`echo "a && b" && echo it\\'s && ls`, ['&&'])).toEqual([
      'echo "a && b"',
      "echo it\\'s",
      'ls',
    ])
  })

  it('never throws on an unclosed quote', () => {
    expect(splitOutsideQuotes('echo "unclosed && ls', ['&&'])).toEqual(['echo "unclosed && ls'])
  })
})

describe('containsCommandSubstitution', () => {
  it.each([
    ['$(npm test)', true],
    ['"$(npm test)"', true],
    ['`npm test`', true],
    ['<(npm test)', true],
    ['>(tee log)', true],
    ['"a=>(b)"', false],
    ['"$(npm test)" inside double quotes still runs', true],
    ["'$(not run)'", false],
    ['plain text', false],
  ])('%s → %s', (text, expected) => {
    expect(containsCommandSubstitution(text)).toBe(expected)
  })
})

describe('isOutsideQuotes', () => {
  it('tells whether a position sits outside quotes', () => {
    const line = 'note "a<<b" <<EOF'
    expect(isOutsideQuotes(line, line.indexOf('<<b'))).toBe(false)
    expect(isOutsideQuotes(line, line.indexOf('<<EOF'))).toBe(true)
  })
})
