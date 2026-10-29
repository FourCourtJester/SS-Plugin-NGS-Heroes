import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import * as core from '@single-studio/core/worker'

import { apiFrom, divisionOf, explain, LEAGUE_API, logos, logoUrl, MAPS, matchOf, standingOf, teamOf } from '../src/league.js'

// Real answers from the league, trimmed, with players' BattleTags replaced.
const recorded = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')).returnObject

const matches = recorded('matches')
const byId = (id) => matches.find((match) => match.matchId === id)

describe('logos', () => {
  it('a stored filename becomes the address the league’s own site draws it from', () => {
    expect(logoUrl('Stormblessed_3562.png')).toBe('https://s3.amazonaws.com/ngs-image-storage/Stormblessed_3562.png')
  })

  it('a filename with spaces and an apostrophe still makes a working address', () => {
    // Real: "Durotan's Couch9326_logo.png". The league's client encodes the whole
    // address with encodeURI, which keeps the apostrophe and escapes the space.
    expect(logoUrl("Durotan's Couch9326_logo.png")).toBe("https://s3.amazonaws.com/ngs-image-storage/Durotan's%20Couch9326_logo.png")
  })

  it('a team with no logo has none, rather than an address that draws nothing', () => {
    expect(logoUrl(null)).toBeNull()
    expect(logoUrl('')).toBeNull()
  })

  it('an address that is already whole is left alone', () => {
    expect(logoUrl('https://s3.amazonaws.com/ngs-image-storage/x.png')).toBe('https://s3.amazonaws.com/ngs-image-storage/x.png')
  })

  it('every logo with a team becomes an image-library entry named for it', () => {
    const teams = recorded('registered').map(teamOf)

    expect(logos(teams)).toContainEqual({
      key: 'ngs/Stormblessed',
      url: 'https://s3.amazonaws.com/ngs-image-storage/Stormblessed_3562.png',
      name: 'Stormblessed',
    })
  })

  // `urlAssets` is new in the core release after 0.15.0. Skipped, visibly, against
  // an older core.
  it.runIf(core.urlAssets)('every logo lands in the image library under its team’s name (core after 0.15.0)', () => {
    const teams = recorded('registered').map(teamOf)
    const patch = core.urlAssets(logos(teams))

    expect(patch['assets.ngs/stormblessed']).toEqual({
      kind: 'url',
      url: 'https://s3.amazonaws.com/ngs-image-storage/Stormblessed_3562.png',
      name: 'Stormblessed',
    })
  })

  it('a team without a logo is not added to the library at all', () => {
    // "Pending" has no logo in season 22.
    const teams = recorded('registered').map(teamOf)

    expect(logos(teams).map((entry) => entry.name)).not.toContain('Pending')
    expect(logos(teams).every((entry) => entry.url)).toBe(true)
  })

  it('logos can be filed under a group of the studio’s choosing', () => {
    expect(logos([{ name: 'Stormblessed', logo: 'https://x/s.png' }], { group: 'teams' })[0].key).toBe('teams/Stormblessed')
  })
})

describe('the season', () => {
  it('a team carries what a graphic draws: name, short name, logo and roster', () => {
    const stormblessed = recorded('registered')
      .map(teamOf)
      .find((team) => team.name === 'Stormblessed')

    expect(stormblessed).toMatchObject({
      id: '6a362b988065dc00226934b8',
      ticker: 'BLS',
      division: 'heroic',
      logo: expect.stringMatching(/Stormblessed_3562\.png$/),
    })
    expect(stormblessed.members.length).toBeGreaterThan(0)
    expect(stormblessed.members.every((tag) => /#\d+$/.test(tag))).toBe(true)
  })

  it('a team really called Pending is a team, not a placeholder', () => {
    expect(
      recorded('registered')
        .map(teamOf)
        .find((team) => team.ticker === 'PENDING'),
    ).toMatchObject({ name: 'Pending', division: 'heroic' })
  })

  it('a division is named for the operator and keyed for the league', () => {
    expect(
      recorded('divisions')
        .map(divisionOf)
        .find((division) => division.key === 'heroic'),
    ).toMatchObject({ name: 'Heroic', teams: expect.arrayContaining(['Stormblessed']) })
  })

  it('the map pool is the twelve the league reports matches on', () => {
    expect(MAPS).toHaveLength(12)
    expect(MAPS).toContain('Alterac Pass')
    expect(MAPS).not.toContain('Haunted Mines')
  })
})

describe('a match', () => {
  it('a match brings both teams and says whether it has been played', () => {
    expect(matchOf(byId('9j1jaymvek8jy8'))).toMatchObject({
      reported: true,
      bestOf: 5,
      home: { name: 'Pending', ticker: 'PENDING' },
      away: { name: 'Hat saika and r' },
    })
    expect(matchOf(byId('avwymv5o4sbc')).reported).toBe(false)
  })

  it('never carries a score, even for a match the league has a result for', () => {
    // The league has 2-3 for this one. The score is the operator's, on the board.
    const { home, away } = matchOf(byId('9j1jaymvek8jy8'))

    expect(Object.keys(home)).toEqual(['id', 'name', 'ticker', 'logo'])
    expect(Object.keys(away)).toEqual(['id', 'name', 'ticker', 'logo'])
  })

  it('a start time arrives as a number a graphic can hand to Date', () => {
    expect(matchOf(byId('9j1jaymvek8jy8')).start).toBe(1793236500000)
  })

  it('a match nobody has scheduled says so, rather than starting in 1970', () => {
    expect(matchOf(byId('9xwoymsi1cx91')).start).toBeNull()
  })

  it('a bracket slot waiting on a team has no side, not a nameless one', () => {
    const slot = matchOf(byId('avwymv5o4sbg'))

    expect(slot.home).toBeNull()
    expect(slot.away).toMatchObject({ name: "Durotan's Couch" })
  })

  it('a match always says how many games it is best of, so a board can say Game 1 of Y', () => {
    // Stated by the league.
    expect(matchOf(byId('9j1jaymvek8jy8'))).toMatchObject({ bestOf: 5, bestOfStated: true })
    // Not stated: the league's own default for the regular season...
    expect(matchOf(byId('9xwoymsi1cxeh'))).toMatchObject({ bestOf: 3, bestOfStated: false })
    // ...and 5 for a playoff match, as every playoff match that states it says.
    expect(matchOf(byId('avwymv5o4sbg'))).toMatchObject({ bestOf: 5, bestOfStated: false })
  })

  it('the caster comes with the match when one signed up', () => {
    expect(matchOf(byId('9j1jaymvek8jy8')).caster).toEqual({ name: 'Rakugan The Gorgon', url: 'https://www.twitch.tv/rakuganvt/' })
  })
})

describe('the table', () => {
  it('wins and losses are maps, and the league’s order is kept', () => {
    const table = recorded('standings').map(standingOf)

    expect(table[0]).toMatchObject({ rank: 1, name: 'Stormblessed', points: 30, wins: 16, losses: 2, played: 8 })
    expect(table.map((row) => row.rank)).toEqual([...table.map((row) => row.rank)].sort((a, b) => a - b))
  })

  it('a withdrawn team stays in the table, under the name the league gave it', () => {
    expect(recorded('standings').map(standingOf).at(-1)).toMatchObject({ name: 'Heretics and Heathens (Withdrawn S22)', points: 0 })
  })
})

describe('talking to the league', () => {
  it('a blank address is the league’s own', () => {
    expect(apiFrom('')).toBe(LEAGUE_API)
    expect(apiFrom('  https://example.com/api/  ')).toBe('https://example.com/api')
  })

  it('a refusal says what the league said', () => {
    expect(explain(400, { message: 'matchId - (string) parameter is required' })).toMatch(/matchId - \(string\) parameter is required/)
    expect(explain(503, 'Service Unavailable')).toMatch(/try again/i)
  })
})
