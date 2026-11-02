import { definePlugin, PluginBase, PluginHandler } from '@single-studio/core/worker'

import { apiFrom, ask, divisionOf, MAPS, matchOf, nameRounds, standingOf, teamOf } from './league.js'

export { apiFrom, divisionOf, explain, LEAGUE_API, logos, logoUrl, MAPS, matchOf, nameRounds, sideOf, standingOf, teamOf } from './league.js'

/**
 * How long one request to the league may take.
 *
 * Twenty seconds rather than the ten a poller gets, because the season's teams with
 * their rosters are a third of a megabyte: 326KB, measured. `fetch` has no deadline
 * of its own, and a request that connects and stalls would leave the plugin waiting
 * for ever.
 */
const BUDGET_MS = 20_000

/**
 * The Nexus Gaming Series: the season at load, a division when a board asks.
 *
 * Not a poller, though it reads a website. What it brings -- the teams, the
 * schedule, the table -- changes between shows, not during one, and the score is
 * the operator's: it is never asked for. Asking every thirty seconds would be a
 * volunteer league's server answering the same question all night for nothing.
 *
 * It is a waterfall, Season > Division > Match > Load, and each fetch narrows the
 * next at the league rather than after the download:
 *
 *   season    the number, divisions, teams with logos and rosters, the maps
 *             -- at load, on the machine that owns the show
 *   matches   one division's matches and its table, rounds named
 *             -- when a board asks, with a division
 *
 * Choosing a match and loading it fetch nothing: by then every match in the list
 * carries its teams, logos, records and best-of, and Load is the studio's own
 * mutation writing them, so going live never waits on the league.
 *
 * The season needs nobody: it is fetched as the plugin starts, which is at load and
 * after every Save of its settings, only on the owner -- the others get it
 * replicated. Its one setting pins a season number, and a number the league is not
 * on is refused rather than half-fetched (see #checked). `season` is still a command,
 * for a board that wants a refetch button, say for a mid-season roster change.
 *
 * A division is a choice, and a plugin's panel holds no choices, so it is a command
 * a board's picker reaches through `ask`, run on the machine where it was asked:
 * one request, not a poll, so there is nothing for an owner to dedupe.
 */
class Ngs extends PluginBase {
  /** What `command` takes. */
  static commands = { season: true, matches: true }

  /** The season the other two are asked about. Learned on first need, then kept. */
  #season = null

  /**
   * Division names by key, `heroic` -> `Heroic`.
   *
   * The two match routes this reads leave the display name out -- 0 of 321 from
   * `schedule/fetch/matches`, none from `schedule/fetch/match` -- so without this a
   * picker offers "nexus r1". Kept from the season's fetch, or asked for once (3KB).
   */
  #names = null

  constructor(context = {}) {
    super('ngs')

    this.config = context.config ?? {}
    this.api = apiFrom(this.config.api)
    this.problem = null

    // The season setting: blank is whatever season the league says it is.
    this.pinned = Number(this.config.season) || null
    this.owner = context.owner ?? (() => true)
  }

  /**
   * Fetches the season, so nobody has to: at load, and on every Save, since a Save
   * restarts a plugin. The season changes every three months or so, and a button
   * pressed that rarely is one nobody remembers.
   *
   * Only on the machine that owns the show. Every machine's worker starts the plugin,
   * and the others get the season replicated, so their fetching it too would be
   * 326KB each for nothing.
   */
  start() {
    this.status = 'connected'

    if (this.owner()) this.#run('season', {}).catch(() => {})
  }

  stop() {
    this.status = 'idle'
  }

  /**
   * The same, from a board: `ctx.ask('ngs', 'matches', { division })`.
   *
   * An unknown name throws, as every plugin's `command` does -- it is a typo in a
   * studio's own code. Anything else returns at once and reports through events
   * and the panel, because `ask` is called from inside a mutation, which cannot
   * wait on a network.
   */
  command(name, data = {}) {
    if (!this.constructor.commands[name]) {
      throw new Error(`ngs has no command "${name}"; it accepts ${Object.keys(this.constructor.commands).join(', ')}`)
    }

    this.#run(name, data).catch(() => {})

    return true
  }

  async #run(name, data) {
    try {
      if (name === 'season') await this.#fetchSeason()
      else if (name === 'matches') await this.#fetchMatches(data)
      else throw new Error(`ngs cannot "${name}"`)

      this.status = 'connected'
      this.problem = null
    } catch (error) {
      const message = error?.message ?? String(error)

      this.status = 'error'
      this.problem = message
      this.emit('problem', { status: error?.status ?? null, message })

      throw error
    }
  }

  /** One request, held to the deadline. */
  async #ask(route, options = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), BUDGET_MS)

    try {
      return await ask(this.api, route, { ...options, signal: controller.signal })
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`The league did not answer within ${BUDGET_MS / 1000}s.`)
      if (error?.status) throw error

      // A refused request reaches here as a bare TypeError, "Failed to fetch". The
      // likeliest causes are the operator's network and a typo in the address.
      throw new Error(`Could not reach the league at ${this.api}. Check the network.`)
    } finally {
      clearTimeout(timer)
    }
  }

  async #currentSeason() {
    if (this.#season === null) {
      const info = await this.#ask('admin/getSeasonInfo')

      this.#season = this.#checked(Number(info?.value) || null)
    }

    if (!this.#season) throw new Error('The league did not say which season it is.')

    return this.#season
  }

  /**
   * The league's season, refused if the setting names another.
   *
   * The league serves only the current season's teams and divisions:
   * `team/get/registered` and `division/get/all` take no season, and a past season's
   * logos are in another bucket. A past season would be its matches with this
   * season's teams, so it is refused rather than half-fetched.
   */
  #checked(current) {
    if (this.pinned && current && this.pinned !== current) {
      throw new Error(`The league is on season ${current}, and only serves the current season's teams. Set Season to ${current}, or leave it blank.`)
    }

    return current
  }

  async #divisionNames() {
    if (!this.#names) this.#names = new Map((await this.#ask('division/get/all')).map(divisionOf).map((division) => [division.key, division.name]))

    return this.#names
  }

  /** A match named as the operator knows its division. */
  #named(match, names) {
    return { ...match, divisionName: names.get(match.division) ?? match.divisionName }
  }

  async #fetchSeason() {
    // Three requests, together. `team/get/registered` is the big one, 326KB for 52
    // teams with rosters; one request for all of them beats 52 for one each.
    const [info, divisions, teams] = await Promise.all([this.#ask('admin/getSeasonInfo'), this.#ask('division/get/all'), this.#ask('team/get/registered')])

    this.#season = this.#checked(Number(info?.value) || null)
    this.#names = new Map((divisions ?? []).map(divisionOf).map((division) => [division.key, division.name]))

    const payload = {
      season: this.#season,
      start: Number(info?.seasonStartDate) || null,
      end: Number(info?.seasonEndDate) || null,
      divisions: (divisions ?? [])
        .filter((division) => division?.public !== false)
        .map(divisionOf)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
      teams: (teams ?? []).map(teamOf).sort((a, b) => a.name.localeCompare(b.name)),
      maps: [...MAPS],
    }

    this.emit('season', payload)
  }

  /**
   * One division's matches, each carrying both teams' records.
   *
   * A division, always: the league filters, so a pick is the 43 matches of Heroic
   * (69KB, 0.6s) rather than all 321 of the season (514KB, 1.6s) filtered here.
   *
   * The division's table comes in the same step, because it is per division too,
   * and because it means every match in the list is already whole: names, logos,
   * records, best-of. Loading one is then the studio's own mutation reading the
   * show, with nothing to ask the league at the moment an operator goes live.
   *
   * `schedule/fetch/matches` rather than the route named for scheduled matches,
   * which leaves out every match without a time -- 43 of season 22's 321 -- and
   * ignores the season it is given.
   *
   * A table that will not come is not a reason to lose the matches. Cup divisions
   * answer in a different shape, and none existed in season 22 to measure against.
   */
  async #fetchMatches({ division } = {}) {
    if (!division) throw new Error('Choose a division first.')

    const season = await this.#currentSeason()
    const [raw, names, standings] = await Promise.all([
      this.#ask('schedule/fetch/matches', { body: { season, division } }),
      this.#divisionNames(),
      this.#ask('standings/fetch/division', { body: { season, pastSeason: false, division } }).then(
        (rows) => (Array.isArray(rows) ? rows.map(standingOf) : null),
        () => null,
      ),
    ])
    const recordOf = (side) => (side && standings ? (standings.find((row) => row.id === side.id) ?? null) : null)
    // Named over the whole division before anything else, since the final can only
    // be found from all of its matches. See nameRounds.
    const matches = nameRounds((raw ?? []).map(matchOf))
      .map((match) => ({
        ...this.#named(match, names),
        home: match.home && { ...match.home, record: recordOf(match.home) },
        away: match.away && { ...match.away, record: recordOf(match.away) },
      }))
      .sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity) || String(a.id).localeCompare(String(b.id)))

    this.emit('matches', { season, division, matches, standings })
  }
}

/**
 * The skeleton a studio fills in.
 *
 * `onSeason({ season, divisions, teams, maps })`, `onMatches({ season, division,
 * matches, standings })` and `onProblem({ status, message })`.
 * What each carries is in the README.
 */
export class NgsHandler extends PluginHandler {
  static handles = { season: 'onSeason', matches: 'onMatches', problem: 'onProblem' }

  onSeason() {}

  onMatches() {}

  onProblem() {}
}

/**
 * Mutations that reach the plugin, for a board's button and division picker.
 *
 *   createVelcroHost({ mutations: { ...mutations, ...ngsMutations }, plugins: [ngs(MyShow)] })
 *   useVelcroMutate()('ngs:matches', { division })
 *
 * They do nothing to the show themselves. They ask, the plugin fetches, and the
 * studio's handler writes what came back. Load is not here: it writes the
 * studio's own paths, so it is the studio's mutation -- see the README.
 */
export const ngsMutations = {
  'ngs:season'(ctx) {
    ctx.ask('ngs', 'season')
  },
  'ngs:matches'(ctx, { division } = {}) {
    if (division) ctx.ask('ngs', 'matches', { division })
  },
}

/**
 * @param {typeof NgsHandler} [Handler]
 */
export const ngs = (Handler = NgsHandler) =>
  definePlugin({
    name: 'ngs',
    label: 'NGS',
    // The settings are the season and nothing else (user, 2026-11-02): no notice,
    // help, actions or league address. A problem still shows, as the row's reason.
    config: [
      {
        key: 'season',
        label: 'Season',
        type: 'number',
        placeholder: 'Current',
        help: 'Leave blank. The league says which season it is on, and that season is fetched whenever the studio loads.',
      },
    ],
    create: (context) => {
      const plugin = new Ngs(context)

      new Handler({ ...context, plugin }).attach(plugin.events)

      return plugin
    },
  })
