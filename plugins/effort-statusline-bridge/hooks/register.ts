import type { EngineInterface, Register } from 'claude-code'

// Writes the level auto-effort-picker holds (the one its footer label shows), or "" when it holds
// none, to ~/.claude/mods-state/effort-statusline-bridge/<session id>.json. The status line script
// compares it with the menu level it gets itself. auto-effort-picker itself is not touched.
// Only the held level is written: hook order follows plugin load order, so e.effort may already be
// the picker's rewrite and cannot tell the menu level.
const OVERRIDE = { plugin: 'auto-effort-picker', key: 'override' } as const

let home = ''
let last: string | null = null

// shortcut: home guessed from the mod's own path (it lives under ~/.claude); no engine API gives it.
function homeOf($: EngineInterface) {
  const m = /^(.*?)[\\/]\.claude[\\/]/.exec($.plugin.root)
  return m?.[1] ?? ''
}

async function write($: EngineInterface, sessionId: string, line: string) {
  // Resolved here, not in session.start: a /reload-plugins does not run session.start again.
  home ||= homeOf($)
  if (!home || line === last) return
  try {
    await $.fs.write(`${home}/.claude/mods-state/effort-statusline-bridge/${sessionId}.json`, JSON.stringify({ line }))
    last = line
  } catch {
    // The status line falls back to the menu level.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    last = null
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const held = await $.state.get(OVERRIDE).catch(() => ({ value: null }))
      await write($, await $.session.id(), held.value ?? '')
    }
    const r = yield* next(e)
    // Hook order follows load order: when auto-effort-picker runs inside this hook, it sets its
    // override only during next(), so read it again afterwards.
    if (e.agentId === undefined) {
      const held = await $.state.get(OVERRIDE).catch(() => ({ value: null }))
      await write($, await $.session.id(), held.value ?? '')
    }
    return r
  })

  // The hold ends between requests too (reset, off, /clear): follow the override as it changes.
  on('state.set', { plugin: 'auto-effort-picker', key: 'override' }, async ($, e, next) => {
    const r = await next(e)
    await write($, await $.session.id(), e.value ?? '')
    return r
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    await write($, e.sessionId, '')
    return next(e)
  })
}
