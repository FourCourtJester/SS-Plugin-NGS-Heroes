import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeSocket, fakeSockets } from '@single-studio/core/testing'

import { example, ExampleHandler, ExamplePoller } from '../src/index'

// Both shapes are tested here because both ship. Delete the half you are not using
// along with the class it covers.

/** The far end's own frame shape. Be exactly as awkward here as the real thing is. */
class ExampleFeed extends FakeSocket {
  frame(Event, Data) {
    this.deliver({ Event, Data })
  }
}

const { sockets, Socket, reset } = fakeSockets(ExampleFeed)

/** Build the plugin the way the host does, with a handler watching. */
const build = (methods, over = {}) => {
  const spies = Object.fromEntries(methods.map((name) => [name, vi.fn()]))

  class MyShow extends ExampleHandler {}

  for (const name of methods) MyShow.prototype[name] = spies[name]

  const plugin = example(MyShow).create({
    mutate: vi.fn(),
    owner: () => true,
    studio: 'test',
    config: { host: '127.0.0.1', port: 4000, ...over },
  })

  return { plugin, spies }
}

beforeEach(() => {
  reset()
  vi.stubGlobal('WebSocket', Socket)
})

describe('the plugin a studio installs', () => {
  it('declares what it is and what it asks for', () => {
    const definition = example(ExampleHandler)

    expect(definition.name).toBe('example')
    // The keys an operator sets are facts about their machine, not about the show.
    expect(definition.config.map((field) => field.key)).toEqual(['host', 'port', 'key'])
  })

  it('names every event it can send, so nothing is discovered by accident', () => {
    expect(Object.keys(ExampleHandler.handles)).toEqual(['score', 'period', 'finished'])
  })

  it('builds the shape the factory says it builds', () => {
    // The one line an author edits when they swap shapes, and the one that is easy
    // to change in `create` while leaving the config and the help describing the
    // other one.
    const { plugin } = build([])

    expect(plugin.constructor.name).toBe('ExampleSocket')
    expect(typeof plugin.url).toBe('string')
  })
})

describe('shape one: something that tells you', () => {
  it('builds its address out of what the operator set', () => {
    const { plugin } = build([], { host: 'localhost', port: 9999 })

    expect(plugin.url).toBe('ws://localhost:9999')
  })

  it('falls back to a default address rather than an unusable one', () => {
    const { plugin } = build([], { host: '', port: '' })

    expect(plugin.url).toBe('ws://localhost:4000')
  })

  it('reaches the studio handler in the shape the plugin promises', () => {
    const { plugin, spies } = build(['onScore'])

    plugin.open()
    sockets[0].open()
    sockets[0].frame('ScoreUpdate', { Home: { TeamName: 'Broncos', Points: 2 }, Away: { TeamName: 'Vandals', Points: 0 } })

    expect(spies.onScore).toHaveBeenCalledWith(expect.objectContaining({ home: { name: 'Broncos', score: 2 } }))
  })

  it('sends a command the far end takes, and refuses one it does not', () => {
    const { plugin } = build([])

    plugin.open()
    sockets[0].open()

    expect(plugin.command('highlight', { team: 'home' })).toBe(true)
    expect(sockets[0].sent).toEqual([{ Command: 'Highlight', Data: { Team: 'home' } }])

    // A name that is not on the list is a typo in studio code, and the far end
    // would swallow the frame without a word.
    expect(() => plugin.command('nope', {})).toThrow(/no command "nope"/)
  })

  it('ignores a frame that is not this protocol rather than throwing', () => {
    const { plugin, spies } = build(['onScore'])

    plugin.open()
    sockets[0].open()
    sockets[0].raw('<html>a proxy said hello</html>')

    expect(spies.onScore).not.toHaveBeenCalled()
  })
})

describe('shape two: something that must be asked', () => {
  const poller = (config, answer) => {
    vi.stubGlobal('fetch', vi.fn(async () => answer))

    return new ExamplePoller({ mutate: vi.fn(), owner: () => true, config })
  }

  it('never asks faster than its floor, whatever is typed', () => {
    expect(poller({ every: 1 }).everySeconds).toBe(5)
  })

  it('hands the deadline to fetch, so a stalled read stops rather than being ignored', async () => {
    let signal = null

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, options) => {
        signal = options?.signal

        return { ok: true, json: async () => ({ Event: 'ScoreUpdate', Data: { Home: { Points: 1 } } }) }
      }),
    )

    const made = new ExamplePoller({ mutate: vi.fn(), owner: () => true, config: { url: 'https://feed.test' } })

    await made.start()
    expect(signal).toBeInstanceOf(AbortSignal)

    await made.stop()
  })

  it('gives up on a refusal and keeps trying on a dropped network', async () => {
    // The distinction that stops a plugin spending quota to be refused again.
    const made = poller({ url: 'https://feed.test' })

    expect(made.fatal(Object.assign(new Error('nope'), { refused: true }))).toBe(true)
    expect(made.fatal(new Error('network went away'))).toBe(false)
  })

  it('says nothing when the answer has not changed', async () => {
    const same = { ok: true, json: async () => ({ Event: 'ScoreUpdate', Data: { Home: { Points: 1 } } }) }
    const made = poller({ url: 'https://feed.test' }, same)
    const heard = vi.fn()

    made.events.on('score', heard)

    await made.start()
    await made.poll()
    await made.poll()

    // The whole reason a poll can be frequent: a read that finds no change costs one
    // request and nothing else -- no emit, no write, no broadcast.
    expect(heard).toHaveBeenCalledTimes(1)

    await made.stop()
  })
})
