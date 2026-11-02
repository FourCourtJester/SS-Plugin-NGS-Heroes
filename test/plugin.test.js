import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ngs, ngsMutations, NgsHandler } from '../src/index.js'

const body = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'))

const answer = (status, json) => ({ ok: status < 400, status, text: async () => JSON.stringify(json) })

/**
 * A league that answers from the recordings, and remembers what it was asked.
 *
 * Keyed on the route and the request body, so a request for the wrong season or
 * the wrong match gets nothing rather than a convincing answer.
 */
const league = (over = {}) => {
  const asked = []
  const routes = {
    'admin/getSeasonInfo': () => answer(200, body('season')),
    'division/get/all': () => answer(200, body('divisions')),
    'team/get/registered': () => answer(200, body('registered')),
    // Filtered by division as the league filters it, so a plugin that fetched the
    // season and filtered here would get a different answer from one that asked.
    'schedule/fetch/matches': (sent) => {
      if (sent?.season !== 22) return answer(400, { message: 'season - (number) parameter is required' })

      const all = body('matches')

      return answer(200, { ...all, returnObject: all.returnObject.filter((match) => !sent.division || match.divisionConcat === sent.division) })
    },
    'standings/fetch/division': (sent) =>
      sent?.season === 22 && sent?.division === 'heroic' ? answer(200, body('standings')) : answer(500, { message: 'nope' }),
    ...over,
  }

  const fetch = vi.fn(async (url, init = {}) => {
    const route = new URL(url).pathname.replace(/^\/api\//, '')
    const sent = init.body ? JSON.parse(init.body) : null

    asked.push({ route, sent, method: init.method ?? 'GET' })

    return routes[route] ? routes[route](sent) : answer(404, { message: 'no route' })
  })

  vi.stubGlobal('fetch', fetch)

  return { asked, fetch }
}

/** A studio's handler that records what it was told. */
const watching = () => {
  const told = { season: [], matches: [], problem: [] }

  class MyShow extends NgsHandler {
    onSeason(payload) {
      told.season.push(payload)
    }

    onMatches(payload) {
      told.matches.push(payload)
    }

    onProblem(payload) {
      told.problem.push(payload)
    }
  }

  return { MyShow, told }
}

/**
 * A running plugin. Not the owner unless asked, because the owner fetches the season
 * the moment it starts, and most tests are about something else.
 */
const build = (Handler = NgsHandler, config = {}, { owner = false } = {}) => {
  const plugin = ngs(Handler).create({ mutate: vi.fn(), owner: () => owner, studio: 's', config })

  plugin.start()

  return plugin
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the season, fetched at load', () => {
  it('on the machine that owns the show, the season arrives at load with nothing pressed', async () => {
    league()
    const { MyShow, told } = watching()

    build(MyShow, {}, { owner: true })
    await vi.waitFor(() => expect(told.season).toHaveLength(1))

    const [season] = told.season

    expect(season.season).toBe(22)
    expect(season.divisions.map((division) => division.key)).toEqual(['heroic', 'nexus', 'b-east'])
    expect(season.teams.map((team) => team.name)).toEqual(['Hat saika and r', 'Pending', 'Stormblessed'])
    expect(season.teams.find((team) => team.name === 'Stormblessed').logo).toMatch(/^https:\/\/s3\.amazonaws\.com\/ngs-image-storage\//)
    expect(season.maps).toHaveLength(12)
  })

  it('asks the league the way it was measured to answer', async () => {
    const { asked } = league()
    const { MyShow, told } = watching()

    build(MyShow, {}, { owner: true })
    await vi.waitFor(() => expect(told.season).toHaveLength(1))

    expect(asked.map((request) => `${request.method} ${request.route}`).sort()).toEqual([
      'GET admin/getSeasonInfo',
      'GET division/get/all',
      'GET team/get/registered',
    ])
  })

  it('on any other machine nothing is fetched at load: the season reaches it replicated', async () => {
    const { asked } = league()

    build(NgsHandler, {}, { owner: false })
    // Long enough for a start-up fetch to have begun, if there were one.
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(asked).toHaveLength(0)
  })

  it('the settings are the season and nothing else: no buttons, no help, no league address', () => {
    const definition = ngs()

    expect(definition.config.map(({ key, type }) => ({ key, type }))).toEqual([{ key: 'season', type: 'number' }])
    expect(definition.actions).toEqual([])
    expect(definition.help).toEqual([])
    expect(definition.summary).toBe('')
  })

  it('a season the league is not on is refused, naming the one it is on, and nothing is written', async () => {
    league()
    const { MyShow, told } = watching()
    const plugin = build(MyShow, { season: 21 }, { owner: true })

    await vi.waitFor(() => expect(told.problem).toHaveLength(1))

    expect(told.season).toHaveLength(0)
    expect(told.problem[0].message).toBe("The league is on season 22, and only serves the current season's teams. Set Season to 22, or leave it blank.")
    expect(plugin.status).toBe('error')
    expect(plugin.problem).toMatch(/Set Season to 22/)
  })

  it('a division is refused the same way under a season the league is not on', async () => {
    const { asked } = league()
    const { MyShow, told } = watching()

    build(MyShow, { season: 21 }).command('matches', { division: 'heroic' })
    await vi.waitFor(() => expect(told.problem).toHaveLength(1))

    expect(told.matches).toHaveLength(0)
    expect(asked.map((request) => request.route)).toEqual(['admin/getSeasonInfo'])
  })

  it('the season the league is on, typed in, is accepted', async () => {
    league()
    const { MyShow, told } = watching()

    build(MyShow, { season: 22 }, { owner: true })
    await vi.waitFor(() => expect(told.season).toHaveLength(1))

    expect(told.season[0].season).toBe(22)
  })

  it('a cleared Season box, which core stores as NaN, means the current season', async () => {
    league()
    const { MyShow, told } = watching()

    build(MyShow, { season: Number.NaN }, { owner: true })
    await vi.waitFor(() => expect(told.season).toHaveLength(1))

    expect(told.season[0].season).toBe(22)
    expect(told.problem).toHaveLength(0)
  })
})

describe('choosing a division', () => {
  it('choosing a division asks the league for that division’s matches and no others', async () => {
    const { asked } = league()
    const { MyShow, told } = watching()

    build(MyShow).command('matches', { division: 'nexus' })
    await vi.waitFor(() => expect(told.matches).toHaveLength(1))

    // The season was not known, so it was asked for first.
    expect(asked.map((request) => request.route)).toEqual(['admin/getSeasonInfo', 'schedule/fetch/matches', 'division/get/all', 'standings/fetch/division'])
    expect(asked[1].sent).toEqual({ season: 22, division: 'nexus' })
    expect(asked[3].sent).toEqual({ season: 22, pastSeason: false, division: 'nexus' })
    expect(told.matches[0].division).toBe('nexus')
    expect(new Set(told.matches[0].matches.map((match) => match.division))).toEqual(new Set(['nexus']))
  })

  it('with no division chosen nothing is fetched, and the panel says to choose one', async () => {
    const { asked } = league()
    const { MyShow, told } = watching()
    const plugin = build(MyShow)

    plugin.command('matches', {})
    await vi.waitFor(() => expect(told.problem).toHaveLength(1))

    expect(asked).toHaveLength(0)
    expect(told.problem[0].message).toBe('Choose a division first.')
  })

  it('once the season is fetched, a division is its matches and its table, nothing else', async () => {
    const { asked } = league()
    const { MyShow, told } = watching()
    const plugin = build(MyShow)

    plugin.command('season')
    await vi.waitFor(() => expect(told.season).toHaveLength(1))
    asked.length = 0

    plugin.command('matches', { division: 'heroic' })
    await vi.waitFor(() => expect(told.matches).toHaveLength(1))

    expect(asked).toEqual([
      { route: 'schedule/fetch/matches', sent: { season: 22, division: 'heroic' }, method: 'POST' },
      { route: 'standings/fetch/division', sent: { season: 22, pastSeason: false, division: 'heroic' }, method: 'POST' },
    ])
  })

  it('a match is named by its division as the operator knows it, which the league’s match routes leave out', async () => {
    league()
    const { MyShow, told } = watching()
    const plugin = build(MyShow)

    plugin.command('matches', { division: 'heroic' })
    await vi.waitFor(() => expect(told.matches).toHaveLength(1))

    expect(told.matches[0].matches.find((match) => match.id === '9j1jaymvek8jy8').divisionName).toBe('Heroic')
  })

  it('each match arrives with its round named, the final found from the whole division', async () => {
    league()
    const { MyShow, told } = watching()

    build(MyShow).command('matches', { division: 'heroic' })
    await vi.waitFor(() => expect(told.matches).toHaveLength(1))

    const byId = Object.fromEntries(told.matches[0].matches.map((match) => [match.id, match.roundName]))

    // The recording has Heroic's regular-season round 5 and playoff round 2, which
    // is the last playoff round in the recording, so it is named the final.
    expect(byId).toEqual({ '9xwoymsi1cxeh': expect.stringMatching(/^Round \d+$/), '9j1jaymvek8jy8': 'Finals' })
  })

  it('matches come soonest first, with the unscheduled ones last', async () => {
    league({
      // Every division at once, so there is an unscheduled match to sort.
      'schedule/fetch/matches': () => answer(200, body('matches')),
    })
    const { MyShow, told } = watching()

    build(MyShow).command('matches', { division: 'any' })
    await vi.waitFor(() => expect(told.matches).toHaveLength(1))

    const starts = told.matches[0].matches.map((match) => match.start)

    expect(starts.at(-1)).toBeNull()
    expect(starts.filter((start) => start !== null)).toEqual([...starts.filter((start) => start !== null)].sort((a, b) => a - b))
  })
})

describe('a division’s table', () => {
  it('every match in a division arrives already carrying both teams’ records, so loading one needs nothing more', async () => {
    league()
    const { MyShow, told } = watching()

    build(MyShow).command('matches', { division: 'heroic' })
    await vi.waitFor(() => expect(told.matches).toHaveLength(1))

    const [{ matches, standings }] = told.matches
    const match = matches.find((one) => one.id === '9j1jaymvek8jy8')

    expect(match).toMatchObject({
      home: { name: 'Pending', record: { rank: 2, points: 28 } },
      away: { name: 'Hat saika and r', record: { rank: 3, points: 25 } },
    })
    expect(standings[0]).toMatchObject({ name: 'Stormblessed', rank: 1 })
  })

  it('a table that will not come still brings the matches, each record left empty', async () => {
    league({ 'standings/fetch/division': () => answer(500, { message: 'down' }) })
    const { MyShow, told } = watching()
    const plugin = build(MyShow)

    plugin.command('matches', { division: 'heroic' })
    await vi.waitFor(() => expect(told.matches).toHaveLength(1))

    expect(told.matches[0].matches).toHaveLength(2)
    expect(told.matches[0].standings).toBeNull()
    expect(told.matches[0].matches[0].home.record).toBeNull()
    expect(plugin.status).toBe('connected')
  })

  it('a division the league cannot answer for says so, and nothing is written', async () => {
    league({ 'schedule/fetch/matches': () => answer(400, { message: 'Bad Request' }) })
    const { MyShow, told } = watching()
    const plugin = build(MyShow)

    plugin.command('matches', { division: 'nowhere' })
    await vi.waitFor(() => expect(told.problem).toHaveLength(1))

    expect(told.matches).toHaveLength(0)
    expect(plugin.status).toBe('error')
  })
})

describe('when the league is not there', () => {
  it('a league that cannot be reached at load says so, as the plugin’s reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    const { MyShow, told } = watching()
    const plugin = build(MyShow, {}, { owner: true })

    await vi.waitFor(() => expect(told.problem).toHaveLength(1))

    expect(plugin.problem).toBe('Could not reach the league at https://nexusgamingseries.org/api. Check the network.')
    expect(plugin.status).toBe('error')
  })

  it('a league that stops answering is given up on, not waited for all night', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          }),
      ),
    )

    try {
      const { MyShow, told } = watching()

      build(MyShow, {}, { owner: true })
      await vi.advanceTimersByTimeAsync(20_000)

      expect(told.problem.map((problem) => problem.message)).toEqual(['The league did not answer within 20s.'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('an address in the config still replaces the league’s, for testing against a copy of it', async () => {
    const { asked } = league()

    vi.mocked(fetch).mockImplementationOnce(async (url) => {
      asked.push({ url: String(url) })

      return answer(200, body('season'))
    })

    build(NgsHandler, { api: 'https://example.com/api/' }).command('season')
    await vi.waitFor(() => expect(asked.length).toBeGreaterThan(0))

    expect(asked[0].url).toBe('https://example.com/api/admin/getSeasonInfo')
  })
})

describe('from a board', () => {
  it('a command the plugin does not take throws, naming the ones it does', () => {
    league()

    expect(() => build().command('teleport')).toThrow(/accepts season, matches/)
  })

  it('the board’s mutations ask the plugin and write nothing themselves', () => {
    const ask = vi.fn()
    const ctx = { ask, set: vi.fn(), get: vi.fn() }

    ngsMutations['ngs:season'](ctx)
    ngsMutations['ngs:matches'](ctx, { division: 'heroic' })
    ngsMutations['ngs:matches'](ctx, {})

    expect(ask.mock.calls).toEqual([
      ['ngs', 'season'],
      ['ngs', 'matches', { division: 'heroic' }],
    ])
    expect(ctx.set).not.toHaveBeenCalled()
    expect(Object.keys(ngsMutations)).toEqual(['ngs:season', 'ngs:matches'])
  })
})
