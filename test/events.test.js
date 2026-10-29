import { describe, expect, it } from 'vitest'

import { EMITS, normalise } from '../src/events'

// The tests worth having first.
//
// A plugin's bugs live in the reshaping, not in the socket: a wrong field name is a
// graphic reading `undefined` for a whole broadcast, with nothing to see and nothing
// to log. These need no network, no fake and no store -- feed the parser a frame,
// assert on the event -- so they are the cheapest useful thing you can write, and
// the ones to write before the plugin works at all.

describe('what the far end says, as the studio hears it', () => {
  it('renames the wire into something a studio would have written', () => {
    const { name, payload } = normalise('ScoreUpdate', {
      Home: { TeamName: 'Broncos', Points: 3 },
      Away: { TeamName: 'Vandals', Points: 1 },
    })

    expect(name).toBe('score')
    expect(payload).toMatchObject({ home: { name: 'Broncos', score: 3 }, away: { name: 'Vandals', score: 1 } })
  })

  it('reads a missing number as zero rather than as nothing', () => {
    // Whatever you are reading will leave fields out. Decide here what absent means,
    // because a studio writing `undefined` into the store deletes the path -- and a
    // deleted score reads as the graphic's fallback, not as 0.
    expect(normalise('ScoreUpdate', { Home: {} }).payload.home.score).toBe(0)
  })

  it('passes an event it has never heard of through under its own name', () => {
    // A far end that adds an event should not make this plugin go quiet about it.
    const { name, payload } = normalise('SomethingNew', { anything: true })

    expect(name).toBe('SomethingNew')
    expect(payload.raw).toEqual({ anything: true })
  })

  it('carries the raw frame on known events too, so an unknown field is findable', () => {
    expect(normalise('PeriodChanged', { Period: '2nd', SecondsRemaining: 300, Extra: 9 }).payload.raw.Extra).toBe(9)
  })

  it('lists what it can emit, from the same table it emits from', () => {
    expect(EMITS).toEqual(['score', 'period', 'finished'])
  })
})
