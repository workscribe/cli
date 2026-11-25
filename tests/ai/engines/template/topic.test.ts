import { describe, it, expect } from 'vitest'
import { topicOf } from '../../../../src/ai/engines/template/topic'

describe('topicOf', () => {
  it.each([
    ['feat/WOR-179-remove-old-data-after-100-days', 'WOR-179: remove old data after 100 days'],
    ['fix/WOR-12', 'WOR-12'],
    ['fix/WOR-12-', 'WOR-12'],
    ['WOR-5-keep_underscores', 'WOR-5: keep underscores'],
    ['user/feat/WOR-5-nested-prefix', 'WOR-5: nested prefix'],
    ['feat/auth-WOR-5', 'WOR-5'],
    ['feat/ABC-1234-two-words', 'ABC-1234: two words'],
  ])('says what %s is about', (branch, topic) => {
    expect(topicOf(branch)).toBe(topic)
  })

  it.each(['feature/auth', 'release/1.2', 'fix/login-bug'])('says nothing for %s: it has no ticket key', (branch) => {
    expect(topicOf(branch)).toBeNull()
  })

  it.each(['main', 'master', 'develop', null])('says nothing for %s', (branch) => {
    expect(topicOf(branch)).toBeNull()
  })
})
