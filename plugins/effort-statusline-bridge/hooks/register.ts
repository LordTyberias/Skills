import type { EngineInterface, Register } from 'claude-code'

// Writes { line, session, turn } to ~/.claude/mods-state/effort-statusline-bridge/<session id>.json
// for the status line script. Neither auto-effort-picker nor any request is changed.
//
// line: the level auto-effort-picker holds (the one its footer label shows), or "" when it holds
// none; the script compares it with the menu level it gets itself. Only the held level is written:
// hook order follows plugin load order, so e.effort may already be the picker's rewrite and cannot
// tell the menu level.
//
// session: the session's ultracode toggle, true / false, or null while unknown (the script then
// falls back to the "ultracode" setting). It follows "/effort ultracode on|off" at once (command.run)
// and Claude Code's own ultra_effort_enter / ultra_effort_exit reminders, which also catch the /effort
// slider, from the next message on. A reload replays the reminders in transcript order; the request
// that replays them carries the newest one last, so the value settles on the current toggle.
//
// turn: true while a turn runs whose typed prompt carries the keyword "ultracode" (the per-turn
// opt-in); it ends with the turn. Read from prompt.submit, not from the workflow_keyword_request
// reminder: a reload replays old reminders, which would mark the running turn.
const OVERRIDE = { plugin: 'auto-effort-picker', key: 'override' } as const

type Mark = { line: string; session: boolean | null; turn: boolean }
const EMPTY: Mark = { line: '', session: null, turn: false }

let home = ''
let mark: Mark = EMPTY
let written = ''

// USERPROFILE on Windows, HOME elsewhere; the mod's own path is no guide under --plugin-dir.
async function homeOf($: EngineInterface) {
  return (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || ''
}

async function write($: EngineInterface, sessionId: string, patch: Partial<Mark>) {
  mark = { ...mark, ...patch }
  // Resolved here, not in session.start: a /reload-plugins does not run session.start again.
  home ||= await homeOf($)
  const json = JSON.stringify(mark)
  if (!home || json === written) return
  try {
    await $.fs.write(`${home}/.claude/mods-state/effort-statusline-bridge/${sessionId}.json`, json)
    written = json
  } catch {
    // The status line falls back to the menu level and the settings files.
  }
}

async function held($: EngineInterface) {
  const r = await $.state.get(OVERRIDE).catch(() => ({ value: null }))
  return r.value ?? ''
}

// "/effort ultracode on|off" → true / false; anything else (the slider, a bare toggle) → undefined.
export function effortSwitch(args: string): boolean | undefined {
  const m = /^\s*ultracode\s+(on|off)\s*$/i.exec(args)
  return m ? m[1].toLowerCase() === 'on' : undefined
}

// What a Claude Code reminder says about the ultracode toggle, or undefined for any other reminder.
export function reminder(type: string): boolean | undefined {
  if (type === 'ultra_effort_enter') return true
  if (type === 'ultra_effort_exit') return false
  return undefined
}

// True when a typed prompt (not a slash command) carries the ultracode keyword.
export function hasKeyword(text: string): boolean {
  return !/^\s*\//.test(text) && /\bultracode\b/i.test(text)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    mark = EMPTY
    written = ''
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) await write($, await $.session.id(), { line: await held($) })
    const r = yield* next(e)
    // Hook order follows load order: when auto-effort-picker runs inside this hook, it sets its
    // override only during next(), so read it again afterwards.
    if (e.agentId === undefined) await write($, await $.session.id(), { line: await held($) })
    return r
  })

  // The hold ends between requests too (reset, off, /clear): follow the override as it changes.
  on('state.set', { plugin: 'auto-effort-picker', key: 'override' }, async ($, e, next) => {
    const r = await next(e)
    await write($, await $.session.id(), { line: e.value ?? '' })
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const r = await next(e)
    const v = effortSwitch(e.args)
    if (v !== undefined) await write($, await $.session.id(), { session: v })
    return r
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    if (!e.isMeta && hasKeyword(e.text)) await write($, await $.session.id(), { turn: true })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.attachment', async ($, e, next) => {
    const v = e.agentId === undefined ? reminder(e.type) : undefined
    if (v !== undefined) await write($, await $.session.id(), { session: v })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined && mark.turn) await write($, await $.session.id(), { turn: false })
    return r
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    await write($, e.sessionId, EMPTY)
    return next(e)
  })
}
