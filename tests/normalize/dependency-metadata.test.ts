import { describe, it, expect } from 'vitest'
import { isShellExpansion, withoutShellExpansions } from '../../src/normalize/dependency-metadata'

describe('isShellExpansion', () => {
  it.each(['$PKG', '${PKG}', '$(cat', '`cat', '"$PKG"', '<(echo'])('says the shell expands %s', (word) => {
    expect(isShellExpansion(word)).toBe(true)
  })

  it.each(['zod', '@scope/pkg@1.2.3', "'$x'", '\\$x'])('says the shell does not expand %s', (word) => {
    expect(isShellExpansion(word)).toBe(false)
  })
})

describe('withoutShellExpansions', () => {
  it('drops the words after an unclosed $( up to the one that closes it', () => {
    expect(withoutShellExpansions(['$(cat', 'a.txt', 'b.txt)', 'zod'])).toEqual(['zod'])
  })

  it('drops the words between two backticks', () => {
    expect(withoutShellExpansions(['`cat', 'a.txt`', 'zod'])).toEqual(['zod'])
  })

  it('keeps every name when none is an expansion', () => {
    expect(withoutShellExpansions(['zod', 'axios'])).toEqual(['zod', 'axios'])
  })
})
