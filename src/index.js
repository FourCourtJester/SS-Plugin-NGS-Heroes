import { definePlugin, PluginHandler, PollingService, SocketService } from '@single-studio/core/worker'

import { normalise } from './events'

export { EMITS, EVENTS, normalise } from './events'

// A Single Studio plugin: bring the outside world in, and emit events.
//
// **It does not write to the show.** That is the whole design. A plugin emits; the
// studio's own handler decides what a goal means to *its* graphics. So a plugin
// installed from npm has no authority over anybody's broadcast, it imposes no
// vocabulary on a studio that already calls things something else, and it is
// testable with no store at all -- feed the parser a frame, assert on the event.
//
// ---------------------------------------------------------------------------
// PICK ONE OF THE TWO CLASSES BELOW AND DELETE THE OTHER.
// ---------------------------------------------------------------------------
//
// The choice is not about the data, it is about who starts the conversation:
//
//   Something that TELLS you        -> SocketService. A game, OBS, a chat service.
//                                      You get the connection, JSON parsing,
//                                      teardown, reconnect backoff, a watchdog for a
//                                      socket that dies without saying so, and a
//                                      connect deadline.
//
//   Something that must be ASKED    -> PollingService. A spreadsheet, a REST API, a
//                                      scoreboard someone types into. You get owner
//                                      gating, change detection, an interval floor
//                                      so a typed 1 cannot burn an hour's quota, a
//                                      read deadline, and the retry-vs-refuse split.
//
// If the far end offers both, take the socket: a poll that finds nothing still costs
// a request, and a socket that says nothing costs nothing at all.
//
// Both classes below emit the *same events*, from the same table in events.js. That
// is worth noticing before you delete one: the shape you pick is an implementation
// detail, and the event table is the contract a studio writes against.

/* ===========================================================================
 * SHAPE ONE: something that tells you. Delete if you are polling.
 * ======================================================================== */

export class ExampleSocket extends SocketService {
  /** How this plugin names itself in logs and error messages. */
  static serviceName = 'example'

  /**
   * What a studio can ask the far end to do, by the name an author uses.
   *
   * A table rather than a method each, for the same reason the events are one: it is
   * the list somebody reads to find out what this plugin accepts, and a name that is
   * not in it throws rather than becoming a frame the far end quietly ignores.
   *
   * Leave it empty if the far end only talks.
   */
  static commands = {
    highlight: ({ team }) => ({ Command: 'Highlight', Data: { Team: team } }),
  }

  get url() {
    const host = this.config.host || 'localhost'
    const port = Number(this.config.port) || 4000

    return `ws://${host}:${port}`
  }

  /**
   * How long to allow with no traffic before deciding the connection is gone, or 0
   * for no watchdog.
   *
   * Worth having wherever the far end sends something periodically -- a socket can
   * die without a close frame, and the symptom is the worst kind: an overlay that
   * looks completely healthy and is frozen. Set it to 0 for a far end that is
   * legitimately silent between events, or a quiet match will look like a drop.
   */
  get silenceBudgetMs() {
    return 0
  }

  /**
   * One frame, already parsed from JSON.
   *
   * Anything you throw here is reported on the operator's board rather than lost.
   */
  async receive(frame) {
    const { name, payload } = normalise(frame?.Event, frame?.Data)

    // Nothing calls `emit('*')` by hand: the emitter fans every event out to
    // wildcard listeners already, and doing it here delivers everything twice.
    this.emit(name, payload)
  }
}

/* ===========================================================================
 * SHAPE TWO: something that must be asked. Delete if you have a socket.
 * ======================================================================== */

export class ExamplePoller extends PollingService {
  static serviceName = 'example'

  /** The fastest this is allowed to ask, whatever an operator types. Seconds. */
  get floorSeconds() {
    return 5
  }

  /**
   * Ask once. Return whatever came back, or throw.
   *
   * `signal` is the read's deadline. Hand it to `fetch` -- without it an abandoned
   * request holds its connection until the far end gives up, and on a short interval
   * those stack.
   */
  async read(signal) {
    const response = await fetch(`${this.config.url}?key=${encodeURIComponent(this.config.key ?? '')}`, { signal })

    if (!response.ok) {
      const problem = new Error(`The feed answered ${response.status}.`)

      // Marked, so `fatal` can tell a refusal from a dropped network without
      // matching on the message text.
      problem.refused = response.status === 401 || response.status === 403

      throw problem
    }

    return response.json()
  }

  /**
   * Whether an error is worth retrying.
   *
   * The distinction that stops a plugin spending quota to be refused again: a bad
   * credential stays bad however many times it is offered, while a dropped network
   * is gone for a moment. Retrying the first is pointless; retrying the second is
   * the whole point.
   */
  fatal(error) {
    return Boolean(error?.refused)
  }

  /** What to emit when something changed. An unchanged answer says nothing at all. */
  publish(value) {
    const { name, payload } = normalise(value?.Event, value?.Data)

    this.emit(name, payload)
  }
}

/* ======================================================================== */

/**
 * The skeleton a studio fills in: one method per event, all no-ops.
 *
 * Deliberately not "any method starting with `on`". A typo in a magic name is a
 * handler that silently never runs, and `handles` is also the list an author reads
 * to find out what this plugin can tell them.
 */
export class ExampleHandler extends PluginHandler {
  static handles = {
    score: 'onScore',
    period: 'onPeriod',
    finished: 'onFinished',
  }

  onScore() {}

  onPeriod() {}

  onFinished() {}
}

/**
 * @param {typeof ExampleHandler} [Handler] The studio's own subclass.
 */
export const example = (Handler = ExampleHandler) =>
  definePlugin({
    // The name a studio addresses this by -- `ctx.ask('example', …)` -- and the key
    // its settings are stored under. It is *not* the npm package name, so it stays
    // short and has no scope.
    name: 'example',
    label: 'Example feed',
    summary: 'What this reads, in one line, on the operator’s board.',

    /**
     * Setup instructions, written by whoever knows, shown where the question is
     * asked.
     *
     * Worth more than it looks. The alternative is a README on a machine that is not
     * the one with the problem, at the moment somebody is trying to get a show on
     * air. `steps` renders as numbered steps, `note` as a caution, `link` as a link.
     */
    help: [
      { type: 'text', text: 'One paragraph on what this connects to and why an operator would want it.' },
      {
        type: 'steps',
        items: ['What they have to switch on at the far end.', 'Where the address or credential comes from.', 'Press Save and reconnect here.'],
      },
      { type: 'note', text: 'Anything that will cost them an hour if they get it wrong.' },
    ],

    /**
     * What the operator sets, on their own machine.
     *
     * The test for what belongs here: **is it a fact about this computer, or about
     * this show?** A port number chosen by whoever runs the game is theirs. A
     * spreadsheet range that the graphics expect columns from is the studio's, and
     * putting it here invites somebody to change it mid-show and see the wrong
     * column with no error anywhere. Pass those to the factory instead.
     *
     * `type: 'secret'` masks a field on the panel. It does not hide it at runtime --
     * the request is made from the browser, so the key is in the network tab of the
     * machine running the board. It is restriction, not concealment; say so in the
     * help.
     */
    config: [
      { key: 'host', label: 'Host', default: 'localhost', help: 'The machine running it. Usually this one.' },
      { key: 'port', label: 'Port', type: 'number', default: 4000 },
      { key: 'key', label: 'API key', type: 'secret', help: 'Only if the far end asks for one.' },
    ],

    create: (context) => {
      // Swap the class here when you swap the shape.
      const plugin = new ExampleSocket(context)

      new Handler({ ...context, plugin }).attach(plugin.events)

      return plugin
    },
  })
