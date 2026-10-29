// The Nexus Gaming Series' API, and its shapes turned into the ones this plugin
// emits. Nothing here touches the framework, so all of it is testable with a
// recorded response and no store.
//
// Measured against the live API on 2026-10-29, during season 22's playoffs; see
// docs/league-api.md for what was measured and what is still open.

/**
 * Where the league's API answers.
 *
 * The bare domain rather than `www.`, which the league's own client uses, because
 * the bare one is the one that was measured: it answers directly, with
 * `Access-Control-Allow-Origin: *`, and a JSON POST's preflight succeeds.
 */
export const LEAGUE_API = 'https://nexusgamingseries.org/api'

/**
 * Where a logo's filename becomes an image.
 *
 * The API stores `Stormblessed_3562.png`, not a URL. The league's client builds
 * the address from its S3 bucket (`team.service.ts`, `imageFQDN`), and so does
 * this. S3 answers as `application/octet-stream` with no CORS header: an `<img>`
 * draws it -- 500x350, measured in Chromium -- and a `fetch` of it is refused, so
 * a logo can be a URL entry in a studio's image library but never stored bytes.
 */
export const LOGO_BASE = 'https://s3.amazonaws.com/ngs-image-storage/'

/**
 * The maps a match can be played on.
 *
 * Not served by the API: the league keeps it in its own match-reporting page
 * (`reporting-deck.component.ts`, `maps`), as a list in the code, and this is a
 * copy of that list at `ngs-mean-core@5ef0ef6`. Haunted Mines, Blackheart's Bay and
 * Warhead Junction are commented out there, so are left out here. When the league
 * changes its pool, this changes with a release.
 */
export const MAPS = Object.freeze([
  'Alterac Pass',
  'Battlefield of Eternity',
  'Braxis Holdout',
  'Cursed Hollow',
  'Dragon Shire',
  'Garden of Terror',
  'Hanamura Temple',
  'Infernal Shrines',
  'Sky Temple',
  'Tomb of the Spider Queen',
  'Towers of Doom',
  'Volskaya Foundry',
])

/** A logo's address, or null for a team that has none. Three of 52 had none in season 22. */
export function logoUrl(file) {
  const name = String(file ?? '').trim()

  if (!name) return null
  // The league's client lets a full address through untouched, so this does too.
  if (/^https?:\/\//i.test(name)) return name

  return encodeURI(`${LOGO_BASE}${name}`)
}

/** An address the operator typed, or the league's own when they typed nothing. */
export function apiFrom(typed) {
  const value = String(typed ?? '').trim()

  return value ? value.replace(/\/+$/, '') : LEAGUE_API
}

/**
 * The sentence an operator reads when a request fails.
 *
 * The league answers a bad request with a `message` naming what it wanted -- "team -
 * (string) parameter is required or ticker ..." -- which is more use than a status.
 */
export function explain(status, body) {
  const said = typeof body === 'object' && body ? body.message : typeof body === 'string' ? body : ''

  if (status === 404) return `The league has no ${said ? `answer: ${said}` : 'such address'}. Is the league address right?`
  if (status >= 500) return `The league's site had a problem${said ? `: ${said}` : ''}. Try again in a minute.`

  return `The league said no (${status})${said ? `: ${said}` : ''}.`
}

/**
 * One request to the league, unwrapped.
 *
 * Every answer is `{ message, route, returnObject }`; the payload is
 * `returnObject`. GET routes take a query string, POST routes a JSON body.
 *
 * @param {string} api
 * @param {string} route Without a leading slash, e.g. `schedule/fetch/match`.
 * @param {{ body?: object, query?: Record<string, unknown>, signal?: AbortSignal }} [options]
 */
export async function ask(api, route, { body, query, signal } = {}) {
  const url = new URL(`${api}/${route}`)

  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value))

  const response = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal } : { signal })
  const text = await response.text()
  let parsed = null

  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }

  if (!response.ok) {
    const problem = new Error(explain(response.status, parsed))

    problem.status = response.status
    throw problem
  }

  return parsed?.returnObject ?? null
}

const number = (value) => {
  const n = Number(value)

  return Number.isFinite(n) && value !== null && value !== '' ? n : null
}

/**
 * A team, as the season list and the match picker want it.
 *
 * `members` are BattleTags, `Name#1234`, which is how the league names players.
 */
export function teamOf(raw) {
  return {
    id: raw?._id ?? raw?.id ?? null,
    name: raw?.teamName ?? '',
    ticker: raw?.ticker ?? '',
    logo: logoUrl(raw?.logo),
    division: raw?.divisionConcat ?? null,
    captain: raw?.captain ?? null,
    members: (raw?.teamMembers ?? []).map((member) => member?.displayName).filter(Boolean),
  }
}

/**
 * One side of a match.
 *
 * No score, deliberately. The score is the operator's, kept on the board: the
 * league only has one once a captain reports the match, after the broadcast, and a
 * plugin that carried it would be one more thing able to overwrite the operator's.
 */
export function sideOf(raw) {
  return {
    id: raw?.id ?? null,
    name: raw?.teamName ?? '',
    ticker: raw?.ticker ?? '',
    logo: logoUrl(raw?.logo),
  }
}

/**
 * A match, flattened.
 *
 * Times are epoch milliseconds, which the league stores as strings
 * (`"1793236500000"`); turned into numbers here so a studio can hand them to
 * `Date`. A match nobody has scheduled has none: 43 of season 22's 321.
 *
 * A side is null when the league does not know it yet. Playoff brackets are made
 * ahead of time, and 16 of season 22's slots were waiting on one team or both.
 *
 * `bestOf` is always a number, because a board says "Game 1 of 5" before a show
 * and a blank there is a broken graphic. The league states it as `boX` on only 26
 * of season 22's 321 matches: all 22 playoff matches that state it say 5, and the 4
 * regular-season ones say 3, which is also the league's own default. So a match
 * that does not say is filled the same way -- 5 for a playoff match, 3 otherwise --
 * and `bestOfStated` is false, for a board that wants to show it was filled. Six
 * playoff matches with both teams decided said nothing, in B East, B West, Nexus and
 * C East; the fill is a guess for those, if a well-founded one.
 */
export function matchOf(raw) {
  const time = raw?.scheduledTime ?? {}
  const caster = raw?.casterName || raw?.casterUrl ? { name: raw?.casterName ?? '', url: raw?.casterUrl ?? '' } : null

  return {
    id: raw?.matchId ?? null,
    season: number(raw?.season),
    division: raw?.divisionConcat ?? null,
    divisionName: raw?.divisionDisplayName ?? raw?.divisionConcat ?? '',
    round: number(raw?.round),
    type: raw?.type ?? null,
    bestOf: number(raw?.boX) ?? (raw?.type === 'tournament' ? 5 : 3),
    bestOfStated: number(raw?.boX) !== null,
    start: number(time.startTime),
    end: number(time.endTime),
    // Whether it has been played and reported, so a picker can leave it out. The
    // result itself is not carried; see sideOf.
    reported: Boolean(raw?.reported),
    forfeit: Boolean(raw?.forfeit),
    home: raw?.home ? sideOf(raw.home) : null,
    away: raw?.away ? sideOf(raw.away) : null,
    caster,
  }
}

/**
 * A row of a division's table.
 *
 * `wins` and `losses` are **maps**, not matches: Stormblessed's 8 matches came to
 * 16 wins and 2 losses. The order is the league's own tiebreak -- points, then head
 * to head, then map differential -- so it is kept rather than re-sorted.
 */
export function standingOf(raw) {
  return {
    rank: number(raw?.standing),
    id: raw?.id ?? null,
    name: raw?.teamName ?? '',
    logo: logoUrl(raw?.logo),
    points: number(raw?.points) ?? 0,
    wins: number(raw?.wins) ?? 0,
    losses: number(raw?.losses) ?? 0,
    played: number(raw?.matchesPlayed) ?? 0,
    dominations: number(raw?.dominations) ?? 0,
  }
}

/** A division, in the league's own order. `teams` are names, as the league keeps them. */
export function divisionOf(raw) {
  return {
    key: raw?.divisionConcat ?? null,
    name: raw?.displayName ?? raw?.divisionConcat ?? '',
    order: number(raw?.sorting),
    teams: [...(raw?.teams ?? [])],
  }
}

/**
 * Team logos as entries for a studio's image library.
 *
 * Feed it to core's `urlAssets` and write the result, and every logo is in the
 * library under the team's name -- `ngs/stormblessed` -- on every machine:
 *
 *   this.mutate('set', urlAssets(logos(teams)))
 *
 * A team without a logo is left out rather than written as an entry that draws
 * nothing.
 *
 * @param {Array<{ name: string, logo: string | null }>} teams
 * @param {{ group?: string }} [options] The library group they are filed under.
 */
export function logos(teams, { group = 'ngs' } = {}) {
  return (teams ?? []).filter((team) => team?.logo && team?.name).map((team) => ({ key: `${group}/${team.name}`, url: team.logo, name: team.name }))
}
