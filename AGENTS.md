# Working on this plugin

For anyone — person or agent — changing the NGS plugin. What it reads, and every
measurement behind it, is in [docs/league-api.md](docs/league-api.md); read that
before changing what a request asks for.

## What it is, and what it deliberately is not

A [Single Studio](https://fourcourtjester.github.io/Single-Studio/) plugin that reads
the Nexus Gaming Series' public API and **emits events**. It never writes to a show:
a studio's handler and mutations do, at the studio's own paths.

Decided by the owner, and not to be undone without asking:

- **Never a score.** The score is the operator's, kept on the board. A match side is
  `{ id, name, ticker, logo, record }`; the league's result, map bans and per-game
  winners are not carried. A side with a `score` key fails a test on purpose.
- **Not a poller.** Nothing it brings changes during a show, so it fetches when
  told. No refresh, no timer.
- **Season > Division > Match > Load.** Fetch season is the panel's one button.
  Choosing a division fetches that division's matches and its table, filtered by the
  league, not after a download. Choosing a match and Load fetch nothing: Load is the
  studio's own mutation, writing what is already in the show.
- **Best-of is always a number**, so a board can say "Game 1 of Y". Stated by the
  league where it says; otherwise 5 for a playoff match and 3 for the regular
  season, with `bestOfStated: false`. The reasoning and counts are in the API notes.

## Testing

```bash
npm test
npm run lint
```

CI runs both, and a pack dry-run, on every push and pull request. Lint also refuses
a relative import in `src/` without its `.js`, which the tests cannot catch: Vitest
resolves it, and Node, loading the published package, does not.

The tests run on recorded answers from the league in `test/fixtures`, trimmed, with
players' BattleTags replaced. The fake league in the tests filters by division the
way the real one does, so a plugin that downloaded the season and filtered it
locally would get a different answer and fail.

**Negative-test every check you add.** Break the code it is meant to catch, watch it
go red, put the code back. A check that cannot fail reads like coverage and is
worse than none. Every test here has been through that, and an assertion that was
true by construction has been removed rather than kept.

Test names are sentences about what the show does —
`'a team really called Pending is a team, not a placeholder'` — not about functions.

Two tests need `urlAssets`, which is new in the core release after 0.15.0. They use
`it.runIf(core.urlAssets)` and show as **skipped** against 0.15.0, not as passing.
When the dev dependency moves to a core that has it, they run.

**Check against the live league before trusting a change to a request.** The
recordings cannot disagree with the code written from them. From Node 22.21 or
later behind a proxy, `fetch` needs `NODE_USE_ENV_PROXY=1`.

## Publishing

This ships **source**, not a build: a studio's bundler compiles it.

- **`@single-studio/core` stays a `peerDependency`.** A normal dependency lets npm
  install a second copy, and two frameworks in one worker means the plugin emits
  and nothing reaches the show, silently.
- **The peer range is `>=0.15.0 <1.0.0`, not a caret.** On a 0.x version `^0.15.0`
  means 0.15.x only, so every core minor release would put this plugin in a peer
  conflict, which npm refuses by default, until it was republished. First-party
  plugins never meet this because they release in lockstep with core; this one
  does not. It uses `definePlugin`, `PluginBase` and `PluginHandler`, and a studio's
  mutations reach it through `ctx.ask`; the tests prove those against 0.15.0. Run
  them against each new core, and narrow the range if one breaks.
- **Relative imports keep their `.js`.** Node resolves this, not a bundler.
- **`repository` names this repository**, or a `--provenance` publish is refused by
  npm's servers with a 422 that `npm pack` never shows.

**Push a version tag to publish**: `git tag v0.1.0 && git push --tags`.
`.github/workflows/publish.yml` checks the tag is the version in `package.json` and
that `repository.url` names this repository, runs the tests and lint, and publishes
with provenance.

The first publish of `@single-studio/plugin-ngs` cannot use a trusted publisher —
npm needs the name to exist first — so it needs an `NPM_TOKEN` secret on this
repository: a granular token with read and write on the `@single-studio` scope, and
**Bypass 2FA on**, or the publish uploads and then stops asking for a code a runner
cannot give. Then add this repository as the package's trusted publisher on npm,
**opt it into `npm publish`** (new ones are stage-only by default), and delete the
secret.

Before the first publish: `npm pack` and look inside. npm refuses to unpublish after
72 hours.

## Comments

Comments say **why**, and what would break if the code changed. Where a decision was
measured, keep the number — `43 of 321`, `69KB in 0.6s` — so somebody can check it.

## Committing

Subject line says what changed, in the show's language. The body says what was
wrong, why this is the fix, what was measured, and what was **not** verified. Never
put a model name or identifier in anything that lands in the repository.
