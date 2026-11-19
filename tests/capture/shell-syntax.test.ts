import { describe, it, expect } from 'vitest'
import {
  closingQuotePositions,
  containsCommandSubstitution,
  isOutsideQuotes,
  splitOutsideQuotes,
} from '../../src/capture/shell-syntax'

describe('closingQuotePositions', () => {
  it('lists the quote marks that end a string, not the ones that start one', () => {
    const command = 'echo "a" -p "b"'
    expect([...closingQuotePositions(command)]).toEqual([command.indexOf('"', 6), command.lastIndexOf('"')])
  })

  it('reads single quotes the same way', () => {
    const line = "echo 'a' -p 'b'"
    expect([...closingQuotePositions(line)]).toEqual([line.indexOf("'", 6), line.lastIndexOf("'")])
  })

  it('does not count a quote inside the other kind as ending anything', () => {
    const line = `echo "it's" x`
    expect([...closingQuotePositions(line)]).toEqual([line.lastIndexOf('"')])
  })

  it('skips escaped quotes', () => {
    const line = 'echo \\" "a" x'
    expect([...closingQuotePositions(line)]).toEqual([line.lastIndexOf('"')])
  })

  it('finds none when the quotes do not pair up', () => {
    expect(closingQuotePositions(`don't set --password "x"`).size).toBe(0)
  })
})

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
