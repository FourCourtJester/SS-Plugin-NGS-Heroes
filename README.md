# @single-studio/plugin-ngs

The [Nexus Gaming Series](https://nexusgamingseries.org) — the amateur Heroes of the
Storm league — for [Single Studio](https://fourcourtjester.github.io/Single-Studio/):
the season's teams, logos and rosters, its matches, and a chosen match with its
division's table. No key and no login; the league's site is public.

```bash
npm i @single-studio/plugin-ngs
```

Needs `@single-studio/core` 0.16.0 or later, which added `urlAssets` and made URL
entries written from a handler draw on every graphic.

## What it does, and when

Nothing on its own, and never a score: the score is the operator's, kept on the
board. It is a waterfall — **Season > Division > Match > Load** — and each fetch
narrows the next at the league:

| Step              | Asks the league for                                           | Your handler hears |
| ----------------- | ------------------------------------------------------------- | ------------------ |
| Fetch season      | the season number, divisions, every team with logo and roster | `onSeason`         |
| Choose a division | that division's matches, and its table                        | `onMatches`        |
| Choose a match    | nothing                                                       |                    |
| Load              | nothing                                                       |                    |

By the time an operator chooses a match, every match in the list already carries
both teams' names, logos and records, its division and its best-of. So **Load is
your own mutation**, writing what is already in the show to the paths your graphics
read, in one transaction. Going live never waits on the league.

Fetch season is a button on the plugin's panel in **Settings → Plugins**, and
`ngs:season` lets a board press it too. Choosing a division is `ngs:matches`.

## The handler, and Load

A plugin never writes to your show; your handler and your mutations do, at your
paths. The paths below are an example.

```js
// src/studio/velcro.worker.js
import { createVelcroHost, urlAssets } from '@single-studio/core/worker'
import { logos, ngs, ngsMutations, NgsHandler } from '@single-studio/plugin-ngs'

class Heroes extends NgsHandler {
  onSeason({ season, divisions, teams, maps }) {
    // Every logo into the image library, as `ngs/<team name>`, on every machine.
    this.mutate('set', urlAssets(logos(teams)))
    this.mutate('set', {
      'variables.ngs.season': season,
      'variables.ngs.divisions': divisions.map(({ key, name }) => ({ key, name })),
      'variables.ngs.maps': maps,
    })
  }

  onMatches({ matches }) {
    // The match picker's choices, each whole, so Load has everything it needs.
    this.mutate('set', {
      'variables.ngs.matches': matches
        .filter((match) => !match.reported)
        .map((match) => ({ ...match, label: `${match.divisionName} r${match.round}: ${match.home?.name ?? 'TBD'} vs ${match.away?.name ?? 'TBD'}` })),
    })
  }
}

const record = (side) => (side?.record ? `${side.record.wins}–${side.record.losses}` : '')

const load = {
  // Pressed once, before going live.
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

createVelcroHost({ name: STUDIO_ID, mutations: { ...mutations, ...ngsMutations, ...load }, plugins: [ngs(Heroes)] })
```

A team with no logo writes an empty logo, which in Single Studio means no value at
all, so whatever your graphic does for a team without one is what shows.

## The board

The pickers are a choice the operator is making, not show state, so they live in the
component.

```jsx
import { useState } from 'react'
import { useVelcroMutate, useVelcroValue } from '@single-studio/core'
import { Panel } from '@single-studio/core/control'

export function NgsPanel() {
  const mutate = useVelcroMutate()
  const divisions = useVelcroValue('variables.ngs.divisions', [])
  const matches = useVelcroValue('variables.ngs.matches', [])
  const [division, setDivision] = useState('')
  const [match, setMatch] = useState('')

  return (
    <Panel title="NGS" actions={<button onClick={() => mutate('ngs:season')}>Fetch season</button>}>
      <select
        value={division}
        onChange={(event) => {
          setDivision(event.target.value)
          setMatch('')
          if (event.target.value) mutate('ngs:matches', { division: event.target.value })
        }}
      >
        <option value="">Division</option>
        {divisions.map((d) => (
          <option key={d.key} value={d.key}>
            {d.name}
          </option>
        ))}
      </select>
      <select value={match} onChange={(event) => setMatch(event.target.value)} disabled={!division}>
        <option value="">Match</option>
        {matches
          .filter((m) => m.division === division)
          .map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
      </select>
      <button disabled={!match} onClick={() => mutate('ngs:load', { id: match })}>
        Load
      </button>
    </Panel>
  )
}
```

## Logos

`logos(teams)` turns the season's teams into image-library entries named for each
team — `ngs/stormblessed` — and core's `urlAssets` writes them where the library
reads. They appear in every `ImagePicker`, under an `ngs` group, on every machine in
the room, and draw on every graphic: they are URL entries, so there are no bytes to
copy. A team without a logo is left out. `logos(teams, { group: 'teams' })` files them
elsewhere.

The logo on a match side is the same URL, so `<Image name="home.logo" />` draws it
directly.

## What each event carries

- **`onSeason`** — `season` (22), `start` and `end` (epoch ms), `divisions`
  (`{ key, name, order, teams }`, in the league's order), `teams`
  (`{ id, name, ticker, logo, division, captain, members }`), and `maps`, the
  twelve-map pool.
- **`onMatches`** — `season`, `division`, `matches` and `standings`. Matches come
  soonest first, unscheduled last, each with `divisionName`, `round`, `bestOf`,
  `start`, `caster` and `reported` — played, for leaving it out of a picker. Each
  side is `{ id, name, ticker, logo, record }`, or null for a playoff slot still
  waiting on a team. No score, ever. `standings` is the division's table in the
  league's order, or null if the league would not give it; then every `record` is
  null too.
- **`onProblem`** — `{ status, message }`, also shown on the plugin's panel.

Things that are easy to get wrong, all measured on the live league:

- **`wins` and `losses` in a record are maps**, not matches.
- **`bestOf` is always a number, but often filled rather than stated.** The league
  states it on 26 of 321 matches. Unstated, it is 5 for a playoff match — as all 22
  playoff matches that state it say — and 3 otherwise, the league's own default.
  `bestOfStated` says which.
- **`start` is null for a match nobody has scheduled**, 43 of 321 in season 22.
- **A team is called `Pending`.** It is a real team.

## The map pool

The league's API does not serve it. `MAPS` is copied from the league's own
match-reporting page and changes with a release of this package.

## The league's API

What this reads, how it answers and where it is wrong — all measured against the live
league — is in [docs/league-api.md](docs/league-api.md).

## Developing

```bash
npm install
npm test
```

The tests run against recorded answers from the league, in `test/fixtures`.

## Licence

MIT.
