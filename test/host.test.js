import 'fake-indexeddb/auto'

import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createVelcroHost, Doc, urlAssets } from '@single-studio/core/worker'

import { logos, ngs, ngsMutations, NgsHandler } from '../src/index.js'

// The whole loop through a real host: a panel button or a board mutation, the
// plugin asking the league, the studio's handler writing, the show holding it.
// The unit tests prove each piece; this proves they are wired to each other.

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'))
const answer = (json, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(json) })

/** `unplayed` serves every match as not yet reported, as on the night it is broadcast. */
const league = ({ unplayed = false } = {}) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      const route = new URL(url).pathname.replace(/^\/api\//, '')
      const sent = init.body ? JSON.parse(init.body) : {}

      if (route === 'admin/getSeasonInfo') return answer(fixture('season'))
      if (route === 'division/get/all') return answer(fixture('divisions'))
      if (route === 'team/get/registered') return answer(fixture('registered'))
      if (route === 'schedule/fetch/matches') {
        const all = fixture('matches')

        return answer({
          ...all,
          returnObject: all.returnObject
            .filter((match) => match.divisionConcat === sent.division)
            .map((match) => (unplayed ? { ...match, reported: false } : match)),
        })
      }
      if (route === 'standings/fetch/division') return answer(fixture('standings'))

      return answer({ message: 'no route' }, 404)
    }),
  )

/** The README's handler and Load mutation, kept in step with it by hand. */
class Heroes extends NgsHandler {
  onSeason({ season, divisions, maps, teams }) {
    this.mutate('set', {
      'variables.ngs.season': season,
      'variables.ngs.divisions': divisions.map(({ key, name }) => ({ key, name })),
      'variables.ngs.maps': maps,
    })
    this.mutate('set', urlAssets(logos(teams)))
  }

  onMatches({ matches }) {
    this.mutate('set', {
      'variables.ngs.matches': matches
        .filter((match) => !match.reported)
        .map((match) => ({ ...match, label: `${match.divisionName} r${match.round}: ${match.home?.name ?? 'TBD'} vs ${match.away?.name ?? 'TBD'}` })),
    })
  }
}

const record = (side) => (side?.record ? `${side.record.wins}–${side.record.losses}` : '')

const load = {
  'ngs:load'(ctx, { id } = {}) {
    const match = (ctx.read('variables.ngs.matches') ?? []).find((one) => one.id === id)

    if (!match) return

    ctx.set({
      'variables.home.name': match.home?.name ?? 'TBD',
      'variables.home.logo': match.home?.logo ?? '',
      'variables.home.record': record(match.home),
      'variables.away.name': match.away?.name ?? 'TBD',
      'variables.away.logo': match.away?.logo ?? '',
      'variables.away.record': record(match.away),
      'variables.maps': ctx.read('variables.ngs.maps') ?? [],
      'variables.tournament.division': match.divisionName,
      'variables.tournament.game': `Game 1 of ${match.bestOf}`,
    })
  },
}

const until = async (predicate, why) => {
  const deadline = Date.now() + 2_000

  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${why}`)
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

let n = 0

const studio = async () => {
  n += 1

  const made = createVelcroHost({ name: `ngs-host-${n}`, persist: false, mutations: { ...ngsMutations, ...load }, plugins: [ngs(Heroes)] })

  await made.started

  return made
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a studio running the plugin', () => {
  it('Fetch season on the panel puts every logo in the image library, under its team’s name', async () => {
    league()
    const made = await studio()

    expect(await made.actPlugin('ngs', 'season')).toEqual({ ok: true })

    expect(Doc.read(made.doc, 'assets.ngs/stormblessed')).toEqual({
      kind: 'url',
      url: 'https://s3.amazonaws.com/ngs-image-storage/Stormblessed_3562.png',
      name: 'Stormblessed',
    })
    // "Pending" has no logo, so no entry that would draw nothing.
    expect(Doc.read(made.doc, 'assets.ngs/pending')).toBeUndefined()
    expect(Doc.read(made.doc, 'variables.ngs.season')).toBe(22)
    expect(Doc.read(made.doc, 'variables.ngs.maps')).toHaveLength(12)
  })

  it('choosing a division offers that division’s matches still to be played', async () => {
    league()
    const made = await studio()

    made.mutate('ngs:matches', { division: 'nexus' })
    await until(() => Doc.read(made.doc, 'variables.ngs.matches'), 'the matches to land')

    const offered = Doc.read(made.doc, 'variables.ngs.matches')

    expect(offered.map((match) => match.id)).toEqual(['avwymv5o4sbc', 'avwymv5o4sbg'])
    expect(offered[1].label).toBe("Nexus r2: TBD vs Durotan's Couch")
  })

  it('Season, Division, Match, Load: everything Load writes is already in the show: teams, logos, maps, division and Game 1 of Y', async () => {
    league({ unplayed: true })
    const made = await studio()

    await made.actPlugin('ngs', 'season')
    made.mutate('ngs:matches', { division: 'heroic' })
    await until(() => Doc.read(made.doc, 'variables.ngs.matches')?.length === 2, 'Heroic’s matches to land')

    made.mutate('ngs:load', { id: '9j1jaymvek8jy8' })

    expect(Doc.read(made.doc, 'variables.home.name')).toBe('Pending')
    expect(Doc.read(made.doc, 'variables.away.name')).toBe('Hat saika and r')
    // Pending has no logo: no value at all, so the studio's own no-logo design shows.
    expect(Doc.read(made.doc, 'variables.home.logo')).toBeUndefined()
    expect(Doc.read(made.doc, 'variables.home.record')).toBe('14–2')
    expect(Doc.read(made.doc, 'variables.maps')).toHaveLength(12)
    expect(Doc.read(made.doc, 'variables.tournament.division')).toBe('Heroic')
    expect(Doc.read(made.doc, 'variables.tournament.game')).toBe('Game 1 of 5')
  })
})
