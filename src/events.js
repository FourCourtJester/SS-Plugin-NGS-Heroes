// What the far end says, in the shape a studio would have written.
//
// This file is the plugin's actual contract, and the reason it is separate from
// index.js: it is pure, it needs no socket and no network, and it is where almost
// all of a plugin's bugs live. A wrong field name here is a graphic reading
// `undefined` for a whole broadcast; there is nothing to see and nothing to log.
//
// Two rules worth keeping when you replace this:
//
//   1. **Rename everything.** Whatever you are reading spells things its own way --
//      PascalCase, Hungarian booleans, teams as numbers. None of that is a studio
//      author's problem. They should write `onScore({ home, away })` without ever
//      learning what the wire calls it.
//
//   2. **Be exactly as awkward as the wire.** If the far end nests a JSON *string*
//      inside its frame, parse it here. A tidier shape than the protocol is a shape
//      that is wrong the first time it meets the real thing.

/** One side of the scoreboard, wherever it appears. */
const side = (raw) => ({
  name: raw?.TeamName ?? null,
  score: Number(raw?.Points ?? 0),
})

/**
 * The table: wire name -> what a studio hears, and how the payload is reshaped.
 *
 * A table rather than a switch, because this is the list somebody reads to find out
 * what the plugin can tell them. `EMITS` below is generated from it, so the two
 * cannot disagree.
 */
export const EVENTS = {
  ScoreUpdate: {
    emit: 'score',
    shape: (data) => ({ home: side(data?.Home), away: side(data?.Away) }),
  },
  PeriodChanged: {
    emit: 'period',
    shape: (data) => ({ period: data?.Period ?? null, clock: Number(data?.SecondsRemaining ?? 0) }),
  },
  MatchFinished: {
    emit: 'finished',
    shape: (data) => ({ winner: data?.WinnerName ?? null }),
  },
}

/**
 * One message, as the event a studio hears.
 *
 * An event the table does not know passes through under its own name with the
 * payload untouched. That is deliberate: a far end that adds an event should not
 * make this plugin go quiet about it, and `raw` is how somebody finds out what
 * arrived without adding a console.log to a published package.
 *
 * @param {string} type
 * @param {unknown} data
 */
export function normalise(type, data) {
  const known = EVENTS[type]

  return {
    name: known?.emit ?? type,
    payload: { ...(known ? known.shape(data) : {}), raw: data },
  }
}

/** Every event this plugin can emit, for anybody enumerating them. */
export const EMITS = [...new Set(Object.values(EVENTS).map((entry) => entry.emit))]
