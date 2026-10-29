# The league's API, as measured

The Nexus Gaming Series, the amateur Heroes of the Storm league, as a data source:
teams, logos, rosters, the schedule, results and standings. Read from the league's
source, [nexusgamingseries/ngs-mean-core] on `development` at `5ef0ef6`
(2026-10-26), then checked against the live API on 2026-10-29, during season 22's
playoffs. The responses in `test/fixtures` are trimmed copies of those answers, with
players' BattleTags replaced; every shape below was measured, and where the source
and the live answer disagree, the live answer is what is written.

Written in the Single Studio repository, where the plugin was first built, and moved
here with it.

[nexusgamingseries/ngs-mean-core]: https://github.com/nexusgamingseries/ngs-mean-core/tree/development/docs/API

## It is open, and a studio may read it directly

Every read a broadcast wants needs no key and no login; the routes behind a login are
writes (reporting, scheduling, casters signing up) and bulk queries a show does not
need.

**A studio reads it from the worker, with no relay.** `server.js` sets
`Access-Control-Allow-Origin: *` on every request. Measured from a page served as
`https://studio.example` in Chromium: a `GET`, and a JSON `POST` with its preflight,
both returned data. The preflight answers `200` with the CORS headers and
`Allow: POST`. The check can fail: the same page's `fetch()` of an S3 logo, which
carries no CORS header, threw `Failed to fetch`.

The host is Heroku. Measured against `https://nexusgamingseries.org`; the site's own
client uses `https://www.nexusgamingseries.org`, which this container's network
policy did not allow, so whether one redirects to the other is unchecked.

## The envelope

GET routes read parameters from the query string, POST routes from a JSON body. Every
answer is

```json
{ "message": "…", "route": "/api/…", "returnObject": … }
```

and the payload is `returnObject`. A missing required parameter is a `400` or `500`
whose `message` lists what was wanted; an unknown `matchId` is a `400`.

## What a show reads

| Route                                 | Method | Takes                              | Gives                                     | Measured        |
| ------------------------------------- | ------ | ---------------------------------- | ----------------------------------------- | --------------- |
| `admin/getSeasonInfo`                 | GET    | `season`, optional                 | `{ value, seasonStartDate, … }`           | 0.2s            |
| `division/get/all`                    | GET    | —                                  | 7 divisions                               | 3KB             |
| `schedule/fetch/match`                | POST   | `matchId`                          | one match                                 | 3KB, 0.7s       |
| `schedule/fetch/matches`              | POST   | `season`; `division`, `round`      | the season's matches, all 321             | 514KB, 1.6s     |
| `schedule/get/matches/scheduled`      | GET    | — (`season` is ignored)            | only those with a time, 278               | 493KB, 1.4s     |
| `standings/fetch/division`            | POST   | `season`, `pastSeason`, `division` | a sorted array                            | 2KB, 0.6s       |
| `team/get`                            | GET    | `team`, `ticker` or **`teamId`**   | one team, roster included                 | 3KB             |
| `team/fetch/teams`                    | POST   | `teams` (names) or `teamTickers`   | several teams                             | 7KB for two     |
| `team/get/registered`                 | GET    | —                                  | every team this season, 52                | 326KB           |
| `schedule/fetch/matchup/history`      | POST   | `teamAid`, `teamBid`               | every meeting of the two                  | 4KB             |
| `schedule/get/matches/casted/playing` | GET    | —                                  | meant to be: matches being cast right now | probably broken |

`division` is the `divisionConcat` — `heroic`, `nexus`, `a`, `b-east`, `b-west`,
`c-east`, `c-west` in season 22 — not the display name.

**The season's matches come from `schedule/fetch/matches`**, with only `season`:
`division` and `round` are optional, and one division alone is 69KB. The route named
for scheduled matches looks like the one to use and is not: it keeps only matches
with a start time, 278 of 321, and reads the current season whatever it is asked.
Neither match route carries the division's display name — `divisionDisplayName` is on
0 of 321 from `fetch/matches` and absent from `fetch/match` — so names come from
`division/get/all`.

## Where the league's API is wrong, measured

- **`team/get` takes `teamId`, not `id`.** The league's docs say `id`; it answers
  `500` with a message listing `teamId`.
- **`team/fetch/teams` by `teamIds` never finds anything.** The route builds
  `{ _ids: { $in: … } }` — a typo for `_id` — and lowercases the ids besides. Two ids
  from a live match returned `[]`; the same two teams by name returned both. Use
  names, tickers, or `team/get?teamId=` one at a time.
- **`casted/playing` is probably always empty.** It asks Mongo for
  `scheduledTime.startTime < Date.now()`, a number, and every one of season 22's 278
  matches stores its times as strings (`"1793236500000"`). Mongo does not compare a
  string with a number, so nothing matches. It returned `[]` here, but at an hour
  with no match in its window either, so that is not proof; one call during a
  scheduled cast settles it. Built on, it would fail silently, so the plugin does not
  depend on it.

All three are worth reporting upstream, along with the scheduled-matches route
ignoring its `season`.

## The shapes

**A match** carries most of what a scoreboard draws, so one request is enough for it:

```json
{
  "matchId": "9j1jaymvek8jy8",
  "season": 22,
  "divisionConcat": "heroic",
  "divisionDisplayName": "Heroic",
  "round": 2,
  "type": "tournament",
  "boX": 5,
  "home": { "id": "695d…", "teamName": "Pending", "ticker": "PENDING", "logo": null, "score": 2 },
  "away": { "id": "6867…", "teamName": "Hat saika and r", "ticker": "hsr", "logo": null, "score": 3 },
  "scheduledTime": { "startTime": "1793236500000", "endTime": "1793241900000" },
  "casterName": "Rakugan The Gorgon",
  "casterUrl": "https://www.twitch.tv/rakuganvt/",
  "mapBans": { "homeOne": "Braxis Holdout", "homeTwo": "Volskaya Foundry", "awayOne": "…", "awayTwo": "…" },
  "other": { "1": { "winner": "away" }, "2": { "winner": "home" } },
  "reported": true
}
```

Counted over all 321 matches of season 22:

- `type` is `seasonal` (282) or `tournament` (39, the playoffs). `boX` is present on
  only 26: 22 tournament matches say 5, 4 seasonal ones say 3, and 17 tournament
  matches have none. Absent means the model's default of 3, which for a playoff
  match is probably wrong, so the plugin leaves it null rather than guess.
- Times are **epoch milliseconds as strings**. 43 matches have none: nobody
  scheduled them. 25 of those are reported anyway, 24 of them as forfeits.
- **A side can be missing.** Playoff brackets are made ahead of time, and 16 slots
  were waiting on one team or both, with no `home` or `away` key at all.
- `casterName` is on 122 of 321.
- `other` holds the winner of each game, once reported.
- Some ids are tournament bracket links: `parentId`, `idChildren`, and the
  Challonge references.

**The score is only there once a captain reports the match.** None of the 31
unreported matches had a `score` on either side, three of them already past their
start. So the plugin is not a live scoreboard: during a series the operator keeps the
score, and the league's result arrives after it. The plugin must not overwrite a score
the operator is keeping with a missing one.

**A team** (`team/get`): `_id`, `teamName`, `ticker`, `logo`, `divisionConcat`,
`captain`, `assistantCaptain`, `teamMembers` as `{ displayName, id }` (BattleTags,
`WHRoger#2994`), plus `twitch`, `twitter`, `youtube` and MMR averages. In season 22,
tickers and ids are unique across all 52 teams, and 3 have no logo.

**A standing** is an array, already sorted:

```json
{
  "standing": 1,
  "teamName": "Stormblessed",
  "id": "6a36…",
  "logo": "Stormblessed_3562.png",
  "points": 30,
  "wins": 16,
  "losses": 2,
  "dominations": 6,
  "matchesPlayed": 8,
  "tiebreakMethod": "points",
  "change": "none"
}
```

`wins` and `losses` are **maps**, not matches. The order is the league's own tiebreak —
points, then head to head, then map differential — so the plugin keeps it rather than
re-sorting. A withdrawn team stays in, renamed: `Heretics and Heathens (Withdrawn
S22)`. Cup divisions use a different, smaller shape, `{ teamName, id, points }`, from
tournament placings; none existed in season 22.

**A team really is called `Pending`.** Ticker `PENDING`, second in Heroic. Nothing may
treat the name as a placeholder.

**A logo is a filename**, `Stormblessed_3562.png`. The site's client turns it into
`https://s3.amazonaws.com/ngs-image-storage/` plus the name, URI-encoded; a past
season's logo lives in `ngs-archive-image` instead. S3 serves them as
`application/octet-stream` and without CORS headers, which does not matter for an
`<img>`: measured in Chromium, it loads at 500×350, and a missing name fires `error`.
So a logo goes into the show as that URL, and core's `<Image>` draws it as is. For
the three teams without one the value is empty, and an `<Image>` with an empty value
draws nothing; how a team with no logo looks is the studio's design. It cannot be fetched into the asset
library's IndexedDB, which would need CORS.

## What was built

This repository, with its own versions; it does not ship with Single Studio. Built
first inside the Single Studio monorepo and moved out, so it is also the first
Single Studio plugin made and published on its own.

Not a poller, and it never asks for a score. The owner's call, on 2026-10-29: team
names do not change during a show and the score is the operator's, kept on the
board. What the plugin brings changes between shows, so it fetches when told, on the
machine where it was told; a press is one request, so there is nothing for an owner
to dedupe.

It is a waterfall, **Season > Division > Match > Load**, and each fetch is a filter
the league applies, not one applied after a download:

| Step                      | Requests                                                        | Event     |
| ------------------------- | --------------------------------------------------------------- | --------- |
| Fetch season (panel)      | `getSeasonInfo`, `division/get/all`, `team/get/registered`      | `season`  |
| Choose a division (board) | `schedule/fetch/matches` and `standings/fetch/division`, for it | `matches` |
| Choose a match, Load      | nothing                                                         |           |

A division is 43 matches, 69KB, 0.6s, where the whole season was 321, 514KB, 1.6s.
The first version fetched the whole season and filtered on the board; asked whether
the steps were filters, it was rebuilt so they are.

- **Load is the studio's own mutation, and fetches nothing.** The table is per
  division, so it comes with the division's matches, and every match in the list
  already carries both teams' names, logos and records, its division and its
  best-of. Load reads the show and writes the studio's paths -- teams, logos, maps,
  the division, "Game 1 of Y" -- in one transaction, pressed once before going live.
  It is not in the plugin, because the paths are the studio's.
- **Best-of is always filled.** A board says "Game 1 of Y" and a blank there is a
  broken graphic. Stated on 26 of 321; every playoff match that states it says 5
  (22 of 22) and the regular-season ones say 3, the league's default -- so unstated
  is 5 for a playoff match and 3 otherwise, with `bestOfStated` false. Six playoff
  matches with both teams decided stated nothing, in B East, B West, Nexus and C
  East; for those it is a well-founded guess.
- **Choosing a division is the board's.** A plugin's panel holds buttons, not
  choices, so it is a mutation (`ngs:matches`) that asks the plugin.
- **No score anywhere.** A match side is `{ id, name, ticker, logo, record }`; the
  bans and per-game winners, which exist only once a match is reported, are not
  carried either. `reported` stays, so a picker can leave played matches out.
- **Logos go into the image library as URL entries**, `ngs/<team name>`, through
  `urlAssets` in the studio's handler; the plugin still writes nothing. That needed a
  fix in Single Studio's core, which ships in the release after 0.15.0: a URL entry only in the room's index was offered by every picker and
  drew nothing on a graphic, because `resolveAsset` read only this machine's
  IndexedDB, and a plugin handler writes from the worker, so its entries are only in
  the index. Now `useAssetUrl` falls back to the index for a URL entry; an e2e check
  deletes a URL entry's local row and still sees the graphic draw it, and fails
  without the fix. A team with no logo gets no entry and an empty logo, and
  draws nothing, which is unchanged.
- **The map pool is a copy.** The API does not serve it; the league's
  match-reporting page has it as a list in the code. Twelve maps.
- **A table that will not come does not lose the matches.** They arrive with every
  record null. Cup divisions answer in a different shape, and none existed to
  measure.

Still open: whether "this week's match" wants a queue rather than one selection;
what a cup division's table looks like; and `casted/playing` during a live cast.
