import type { EngineInterface, Register, SessionMessage } from 'claude-code'

import type { Band, Level } from '../types'

const BAND = { plugin: 'auto-effort-picker', key: 'band' } as const
const OVERRIDE = { plugin: 'auto-effort-picker', key: 'override' } as const
// Fits the footer slot (about 14 cells).
const SHORT = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', max: 'Max' } as const

const LEVELS: readonly Level[] = ['low', 'medium', 'high', 'xhigh', 'max']
const NAMES: Record<Level, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }

const APPLIED_MS = 15000
const PICK_TIMEOUT_MS = 8_000
const ACCENT = '#d97757'
const GOOD = '#16a34a'
const BAD = '#dc2626'

type Mode = 'suggest' | 'auto'
type Pick = { level: Level | 'keep'; why: string }

// Approvals and answers go on with earlier work: they keep the level without a pick.
const AGREE = /^(ja|jo|yes|yep|ok(ay)?|go|weiter|passt|genau|do it|go on|continue|mach (das|weiter|es)|option \d+|\d+)[\s.!]*$/i
const isAgree = (text: string) => text.length <= 3 || AGREE.test(text)

// Module variables reset on a reload; the band and the override live in $.state.
let enabled = true
let mode: Mode = 'suggest'
// Bumped on every prompt, so a slow pick for an older prompt is dropped.
let gen = 0
let nextId = 1
// The level the main chat's last request ran at, before this mod touched it.
let seen: Level | '' = ''
// The level for the rest of the running turn, set by a Switch or by auto mode.
let turnLevel: Level | null = null
// The level the mod puts on requests, and the picker level it saw when it took over.
let hold: { level: Level; base: string } | null = null
let lastEffort = ''
let lastWant = ''
let keysLogged = false
// The prompt waiting for its pick at the turn's first request.
let held: { text: string; mine: number } | null = null

// A run is one /ticket or /repo-security-hardening, from its prompt to the build pick.
// Its state survives the questions in between and is only reset by the next run or a new session.
let runId = 0
// The /ticket run waits for the ticket text from YouTrack.
let ticketWait: number | null = null
const TICKET_TOOL = 'mcp__youtrack__get_issue'
// The same run: the approved plan picks again, for the build.
let planWait: number | null = null
// An epic is a choice, not the work: the pick waits for the sub-ticket the run moves to In Progress.
let epicId = ''
let loaded = new Map<string, string>()

// The prompt is a /repo-security-hardening run: the pick judges the review, the approved plan picks again for the build.
const SECURITY = /^\/repo-security-hardening\b/i
let securityRun = false
const securityText = (args: string) => `A security review of this repository by the repo-security-hardening skill: inventory, dependency and secret scans, static analysis, attack surface review, and a rated findings report. It runs in plan mode until the user approves the selected changes. Judge the review work.${args ? `\nArguments: ${args}` : ''}`

function resetRun() {
  ticketWait = null
  planWait = null
  epicId = ''
  loaded = new Map()
  securityRun = false
}

async function pickTicket($: EngineInterface, ticket: string) {
  ticketWait = null
  loaded = new Map()
  const text = `A ticket to work through, loaded from YouTrack:\n${ticket}`
  if (mode === 'auto') await autoAdjust($, text, gen).catch(err => log($, 'ticket auto', err))
  else await suggest($, text, gen).catch(err => log($, 'ticket suggest', err))
}

// plugin.root may carry backslashes on Windows, and a directory install lies outside ~/.claude.
// shortcut: home guessed from the path, no engine API gives it; a root outside the user folder reads no switchboard.
function homeOf($: EngineInterface) {
  const r = $.plugin.root
  const m = /^(.*?)[\\/]\.claude[\\/]/.exec(r) ?? /^(.*?[\\/](?:Users|home)[\\/][^\\/]+)/i.exec(r)
  return m?.[1] ?? r
}

// The /mods switchboard turns this mod off in every chat with switches.json.
const NAME = 'auto-effort-picker'
let off = false
let switchTimer: { cancel: () => void } | null = null

async function readSwitch($: EngineInterface) {
  let now = false
  try {
    const path = `${homeOf($)}/.claude/mods/switches.json`
    if (await $.fs.exists(path)) {
      const json = JSON.parse(String(await $.fs.read(path))) as Record<string, unknown>
      now = json[NAME] === false
    }
  } catch {
    now = off
  }
  if (now === off) return
  off = now
  if (off) {
    release($)
  }
  redraw($)
}

// The log lives in the plugin's own store (no file), shown by /auto-effort-picker log.
// One write at a time: each line reads and rewrites the entry, so parallel writers would drop lines.
const LOG_KEY = 'log'
const LOG_CHARS = 20_000
let logQueue: Promise<void> = Promise.resolve()
function log($: EngineInterface, what: string, err: unknown) {
  logQueue = logQueue.then(async () => {
    try {
      const old = await $.store.get(LOG_KEY)
      const msg = err instanceof Error ? err.message : String(err)
      await $.store.set(LOG_KEY, `${typeof old === 'string' ? old.slice(-LOG_CHARS) : ''}${new Date(await $.clock.now()).toISOString()} ${what}: ${msg}\n`)
    } catch {
      // Nowhere left to report it.
    }
  })
  return logQueue
}

async function getBand($: EngineInterface): Promise<Band | null> {
  const { value } = await $.state.get(BAND)
  return value ?? null
}

async function setBand($: EngineInterface, b: Band | null) {
  await $.state.set(BAND, b)
}

// "Extra high", "x-high" and "xhigh" all read as xhigh.
function norm(s: string) {
  const t = s.toLowerCase().replace(/[^a-z]/g, '')
  if (t === 'extrahigh' || t === 'xhigh') return 'xhigh'
  return t
}

function asLevel(v: unknown): Level | '' {
  if (typeof v !== 'string') return ''
  const t = norm(v)
  return (LEVELS as readonly string[]).includes(t) ? (t as Level) : ''
}

// The level the chat runs at now: the last request's.
async function currentLevel(_$: EngineInterface): Promise<Level | ''> {
  return seen
}

// The app keeps its effort menu to the person, so this mod puts the level on every request until the person
// moves the picker. No setting is changed and no /effort command is run.
const HOLD_NOTE = 'the app lets no mod change its effort menu'
async function applyLevel($: EngineInterface, level: Level) {
  turnLevel = level
  const note = HOLD_NOTE
  hold = { level, base: lastEffort }
  await $.state.set(OVERRIDE, level)
  redraw($)
  return note
}

function redraw($: EngineInterface) {
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // The next state change redraws anyway.
  }
}

// Plain text: no em or en dashes, never the banned word, one short line.
function cleanWhy(raw: string) {
  const r = raw
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\bship(s|ped|ping)?\b/gi, 'publish')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'`\s]+|["'`\s.]+$/g, '')
  return r.slice(0, 90)
}

function lastAssistantText(messages: readonly SessionMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!
    if (m.role === 'assistant' && m.text.trim()) return m.text
  }
  return ''
}

// Short follow-ups ("yes, do that") refer to the end of the reply, so both ends go in.
function replyEnds(text: string) {
  return text.length <= 600 ? text : `${text.slice(0, 300)}\n[…]\n${text.slice(-300)}`
}

// The four-question framework: stop at the first yes.
function pickPrompt(text: string, lastReply: string, now: Level | '') {
  return `You pick the effort level an AI assistant (Claude) should use for one prompt. Effort sets how much time, reading and checking Claude spends, and how many decisions it makes alone. It is not how smart Claude is.

Ask these four questions in this order and stop at the first yes:

1. Will the person go back and forth with Claude on this, or is it a simple task? Then low.
   Examples: brainstorming options, quick rewrites (friendlier, shorter), sorting or tagging items, short summaries, rough first drafts or outlines, small tweaks to something already made, simple questions.
2. Would a hidden mistake cost money, a client, trust or a wrong decision? Then high.
   Examples: checking numbers across sources, open-ended analysis with no set path (why did churn go up), reviewing a contract for risk, fact-checking, going through long documents, verifying and testing work made at a lower level, building or fixing a skill.
3. Is the person handing off a long, hard and critical job and walking away, with no time to answer questions? All three must be true. Then xhigh.
   Examples: a full research report from a year of calls and tickets, reviewing a 50 page agreement before signing, an investor pitch deck as the best one shot. Answer max only when the prompt asks for the deepest possible work and says it is critical; otherwise xhigh.
4. Everything else is medium: everyday writing, repurposing content, meeting summaries with decisions and next steps, standard reports in a set format, quick research before a call. If you are not sure, medium.

A task being long does not make it high. Rule-following work stays low or medium.
The words ultrathink or ultracode in the prompt ask on purpose for deeper, higher quality work.
If the prompt is a ticket, judge the work the ticket asks for, not the interview and planning before it.
If the prompt only approves, answers a question, or says to go on with earlier work (yes, go, ok, do it, option 2), answer keep.

The chat runs at: ${now || 'unknown'}

Claude's last reply (its first and last 300 characters, for context):
<reply>
${lastReply || '(none, this is the first prompt)'}
</reply>

The new prompt:
<prompt>
${text}
</prompt>

Reply with JSON only: {"level": "low|medium|high|xhigh|max|keep", "why": "the reason in under 12 plain words"}`
}

// keep is an answer, null is a failure.
function parsePick(text: string): Pick | null {
  const m = /\{[\s\S]*\}/.exec(text)
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as { level?: unknown; why?: unknown }
    const level = typeof j.level === 'string' && j.level.trim().toLowerCase() === 'keep' ? 'keep' : asLevel(j.level)
    if (!level) return null
    return { level, why: cleanWhy(typeof j.why === 'string' ? j.why : '') }
  } catch {
    return null
  }
}

async function pick($: EngineInterface, text: string, now: Level | ''): Promise<Pick | null | 'aborted'> {
  const start = await $.clock.now()
  const messages = await $.session.messages()
  const lastReply = replyEnds(lastAssistantText(messages))
  const r = await $.model.complete({
    model: 'claude-sonnet-5-5',
    // Tickets and plans run long; the small pick reads all of a normal one.
    prompt: pickPrompt(text.slice(0, 40_000), lastReply, now),
    maxTokens: 200,
    effort: 'low',
    timeoutMs: PICK_TIMEOUT_MS,
  })
  const ms = (await $.clock.now()) - start
  // A cancelled turn or a newer prompt aborts the pick: that is no failure to show.
  // The engine reports the timeout as aborted too, so an abort at the limit is a failure.
  if (!r.isAnswered && r.reason === 'aborted' && ms < PICK_TIMEOUT_MS) {
    void log($, 'pick aborted', `after ${ms} ms`)
    return 'aborted'
  }
  if (!r.isAnswered) throw new Error(`pick failed after ${ms} ms: ${r.reason}`)
  const p = parsePick(r.text)
  if (p) void log($, 'pick', `${p.level} (${p.why || 'no reason'}) in ${ms} ms`)
  else void log($, 'pick unreadable', `in ${ms} ms: ${r.text.slice(0, 200)}`)
  return p
}

// A failed or unreadable pick keeps the level and says so in the band.
async function tryPick($: EngineInterface, text: string, now: Level | '') {
  let what = 'Pick failed'
  try {
    const p = await pick($, text, now)
    if (p === 'aborted') return null
    if (p) return p
  } catch (err) {
    await log($, 'pick', err)
    if (err instanceof Error && err.message.endsWith(': aborted')) what = 'Pick timed out'
  }
  const id = nextId++
  // level is unused in the failed band; from carries the level that stays.
  await setBand($, { phase: 'failed', id, level: now || 'medium', from: now, why: '', note: `${what}, level stays ${now ? NAMES[now] : 'as it is'}` })
  hideLater($, id)
  return null
}

// A timer of its own: a sleep ends with the dispatch that started it, so a cancelled turn left the band up.
function hideLater($: EngineInterface, id: number) {
  try {
    $.clock.after(APPLIED_MS, () => {
      void (async () => {
        const b = await getBand($)
        if (b && b.id === id && (b.phase === 'applied' || b.phase === 'failed')) await setBand($, null)
      })().catch(err => log($, 'hide', err))
    })
  } catch (err) {
    void log($, 'hide', err)
  }
}

async function showApplied($: EngineInterface, p: { level: Level; why: string }, from: Level | '', note: string) {
  const id = nextId++
  await setBand($, { phase: 'applied', id, level: p.level, from, why: p.why, note })
  hideLater($, id)
}

async function withStatus<T>($: EngineInterface, text: string, fn: () => Promise<T>) {
  try {
    await $.ui.status(text)
  } catch {
    // The status line is a nicety.
  }
  try {
    return await fn()
  } finally {
    try {
      await $.ui.status(undefined)
    } catch {
      // Nothing to clear.
    }
  }
}

// Suggest mode: pick before the prompt goes in and, when the level differs, ask in a dialog before Claude starts.
async function suggest($: EngineInterface, text: string, mine: number) {
  const now = await currentLevel($)
  const p = await withStatus($, 'checking effort…', () => tryPick($, text, now))
  if (!p || p.level === 'keep' || mine !== gen || p.level === now) return
  const level = p.level
  const go = `Switch to ${NAMES[level]}`
  const auto = 'Switch, and auto-adjust from now'
  const keep = now ? `Keep ${NAMES[now]}` : 'Keep it as it is'
  let answer = ''
  try {
    answer = await $.ui.ask(`This looks like a ${NAMES[level]} effort task${p.why ? `: ${p.why}` : ''}. Switch before Claude starts?`, {
      options: [go, auto, keep],
      header: 'Effort',
    })
  } catch {
    // A dismissed dialog keeps the level and sends the prompt.
    return
  }
  if (answer !== go && answer !== auto) return
  if (answer === auto) {
    mode = 'auto'
    await $.store.set('mode', mode)
  }
  const note = await applyLevel($, level)
  await showApplied($, { level, why: p.why }, now, note)
}

// Auto mode: pick before the prompt goes in, so the first request already runs at the right level.
async function autoAdjust($: EngineInterface, text: string, mine: number) {
  const now = await currentLevel($)
  const p = await withStatus($, 'picking effort…', () => tryPick($, text, now))
  // A pick equal to the picker needs nothing held: the menu stays in charge.
  if (!p || p.level === 'keep' || mine !== gen || p.level === now) return
  const note = await applyLevel($, p.level)
  await showApplied($, { level: p.level, why: p.why }, now, note)
}

function release($: EngineInterface) {
  hold = null
  turnLevel = null
  lastWant = ''
  void $.state.set(OVERRIDE, null).then(() => redraw($)).catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    resetRun()
    await $.command.register({
      name: 'auto-effort-picker',
      description: 'Auto Effort Picker. auto: set effort by itself. suggest: ask before switching. status, reset, log, off or on',
      argumentHint: '[auto|suggest|status|reset|log|off|on]',
    })
    enabled = (await $.store.get('enabled')) !== false
    mode = (await $.store.get('mode')) === 'auto' ? 'auto' : 'suggest'
    await readSwitch($).catch(() => undefined)
    switchTimer = $.clock.every(3000, () => {
      void readSwitch($).catch(() => undefined)
    })
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (off || !enabled) return next(e)
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return next(e)
    const text = e.text.trim()
    const isTicket = /^\/ticket\b/i.test(text)
    const isSecurity = SECURITY.test(text)
    held = null
    if (!text) return next(e)
    // Other slash commands are not picked, and do not inherit an old hold. The mod's own command handles the hold itself.
    if (text.startsWith('/') && !isTicket && !isSecurity) {
      if ((hold || turnLevel) && !/^\/auto-effort-picker\b/i.test(text)) release($)
      return next(e)
    }
    gen += 1
    if (isAgree(text)) {
      void log($, 'prefilter', `keep for "${text.slice(0, 40)}"`)
      return next(e)
    }
    turnLevel = null
    if (isTicket || isSecurity) {
      runId += 1
      resetRun()
      securityRun = isSecurity
    }
    // The pick waits for the turn's first request, which carries the level the chat really runs at.
    if (isTicket) ticketWait = planWait = runId
    else held = { text: isSecurity ? securityText(text.replace(SECURITY, '').trim()) : text, mine: gen }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Every main-chat request: note its level, and put the chosen one on it when the setting could not be changed.
  on('turn.step', async function* ($, e, next) {
    if (off || e.agentId !== undefined || typeof e.effort !== 'string') return yield* next(e)
    if (!keysLogged) {
      keysLogged = true
      void log($, 'turn.step keys', Object.keys(e).join(', '))
    }
    lastEffort = e.effort
    // The picker moved (by hand, or /effort landed): the mod lets go.
    if (hold && e.effort !== hold.base) {
      hold = null
      turnLevel = null
    }
    let value: Level | null = enabled && hold ? hold.level : null
    if (!hold && (await $.state.get(OVERRIDE)).value) {
      await $.state.set(OVERRIDE, null)
      redraw($)
    }
    // What the chat runs at now: the level the mod holds, else the picker's.
    seen = value ?? (asLevel(e.effort) || seen)
    if (held && e.index === 0 && enabled) {
      const pending = held
      held = null
      if (pending.mine === gen) {
        if (mode === 'auto') await autoAdjust($, pending.text, pending.mine).catch(err => log($, 'auto', err))
        else await suggest($, pending.text, pending.mine).catch(err => log($, 'suggest', err))
      }
      value = enabled && hold ? hold.level : null
    }
    const want = turnLevel ?? (enabled ? (value ?? null) : null)
    if (!want || want === e.effort) {
      lastWant = ''
      return yield* next(e)
    }
    if (want !== lastWant) {
      lastWant = want
      const sid = await $.session.id().catch(() => '?')
      void log($, 'request', `session ${sid} #${e.index}: ${e.effort} -> ${want}`)
    }
    return yield* next({ ...e, effort: want })
  })

  // /ticket: pick from the first ticket the main chat loads, then hold that level for the rest of the turn.
  // An epic waits: its sub-tickets are kept until the run moves the chosen one to In Progress.
  on('tool.call', { tool: TICKET_TOOL }, async ($, e, next) => {
    const r = await next(e)
    if (off || !enabled || ticketWait === null || ticketWait !== runId || e.agentId !== undefined) return r
    if (r.deny || r.isError || !r.text) return r
    let issue: { id?: unknown; customFields?: { Type?: unknown } } = {}
    try {
      issue = JSON.parse(r.text) as typeof issue
    } catch {
      // Not JSON: judge the text as it is.
    }
    const id = typeof issue.id === 'string' ? issue.id : ''
    if (epicId) {
      if (id) loaded.set(id, r.text)
      return r
    }
    if (id && issue.customFields?.Type === 'Epic') {
      epicId = id
      return r
    }
    await pickTicket($, r.text)
    return r
  }).catch(($, e, next) => next(e))

  // The epic's chosen sub-ticket goes to In Progress (ticket.md step 1a): pick from its loaded text.
  on('tool.call', { tool: 'mcp__youtrack__update_issue' }, async ($, e, next) => {
    const r = await next(e)
    if (off || !enabled || !epicId || ticketWait === null || ticketWait !== runId || e.agentId !== undefined) return r
    if (r.deny || r.isError) return r
    const id = typeof e.issueId === 'string' ? e.issueId : ''
    const state = (e.customFields as { State?: unknown } | undefined)?.State
    const ticket = loaded.get(id)
    if (id === epicId || state !== 'In Progress' || !ticket) return r
    await pickTicket($, ticket)
    return r
  }).catch(($, e, next) => next(e))

  // /ticket and /repo-security-hardening: the approved plan sets the level for the build; the first pick covered planning.
  // A rejected plan comes back as an error, so the next ExitPlanMode tries again.
  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    const r = await next(e)
    if (off || !enabled || e.agentId !== undefined) return r
    if (!securityRun && (planWait === null || planWait !== runId)) return r
    if (r.deny || r.isError) return r
    const plan = (r.result as { plan?: string | null } | undefined)?.plan
    if (!plan) return r
    const mine = gen
    planWait = null
    securityRun = false
    const text = `An approved plan to build now, judge the build work:
${plan}`
    if (mode === 'auto') await autoAdjust($, text, mine).catch(err => log($, 'plan auto', err))
    else await suggest($, text, mine).catch(err => log($, 'plan suggest', err))
    return r
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    // /clear and resume go on in this process without a session.start: the poll stays, the run ends.
    if (e.reason !== 'clear' && e.reason !== 'resume') {
      switchTimer?.cancel()
      switchTimer = null
    }
    resetRun()
    return next(e)
  })

  on('command.run', { command: 'auto-effort-picker' }, async ($, e) => {
    if (off) return { text: 'Auto Effort Picker is off. Turn it on with /mods.' }
    const arg = e.args.trim().toLowerCase()
    if (arg === 'auto' || arg === 'suggest') {
      mode = arg
      enabled = true
      await $.store.set('mode', mode)
      await $.store.set('enabled', true)
      return {
        text:
          mode === 'auto'
            ? 'Auto Effort Picker: auto. Every prompt now gets the effort level it needs, set by itself.'
            : 'Auto Effort Picker: suggest. When a prompt needs another level, a dialog asks before Claude starts.',
      }
    }
    if (arg === 'off' || arg === 'on') {
      enabled = arg === 'on'
      await $.store.set('enabled', enabled)
      if (!enabled) {
        release($)
        await setBand($, null)
      }
      return { text: enabled ? `Auto Effort Picker is on (${mode}).` : 'Auto Effort Picker is off. Type /auto-effort-picker on to turn it back on.' }
    }
    if (arg === 'reset') {
      release($)
      return { text: 'Auto Effort Picker: hold released, the chat follows the effort menu again.' }
    }
    if (arg === 'log') {
      await logQueue
      const text = await $.store.get(LOG_KEY)
      return { text: typeof text === 'string' && text ? `Auto Effort Picker log (newest last):\n${text.slice(-4_000)}` : 'Auto Effort Picker log is empty.' }
    }
    if (arg !== '' && arg !== 'status') return { text: `Unknown argument "${arg}". Allowed: auto, suggest, status, reset, log, off, on.` }
    const picker = asLevel(lastEffort) || (await currentLevel($))
    const sent = lastWant ? asLevel(lastWant) : picker
    return {
      text: [
        `Auto Effort Picker is ${enabled ? 'on' : 'off'}, mode: ${mode}.`,
        `Picker level: ${picker ? NAMES[picker] : 'unknown yet'}. Sent level: ${sent ? NAMES[sent] : 'unknown yet'}.`,
        `Hold: ${hold ? `${NAMES[hold.level]} until the menu moves away from ${hold.base || 'its level'}` : 'none'}.`,
        'Type /auto-effort-picker auto, suggest, status, reset, log, off or on.',
      ].join('\n'),
    }
  })

  on('ui.press', { plugin: 'auto-effort-picker', element: 'info' }, async ($, e) => {
    const b = await getBand($)
    if (b) await setBand($, { ...b, phase: 'info' })
    return { element: e.element }
  })

  on('ui.press', { plugin: 'auto-effort-picker', element: 'info-close' }, async ($, e) => {
    await setBand($, null)
    return { element: e.element }
  })

  // The app's model menu belongs to the app: it refuses a chat that changes its own effort.
  // So the footer slot beside it names the level the mod really sends.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (off || !enabled) return next(e)
    const { value } = await $.state.get(OVERRIDE)
    if (!value) return next(e)
    const label = `Effort ${SHORT[value]}`
    if (e.surface === 'desktop' || e.surface === 'vscode') {
      const { Text } = $.ui.resolve(e)
      return <Text color="#d97757">{label}</Text>
    }
    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, label] } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (off || !enabled || e.props.hasSurvey) return next(e)
    const b = await getBand($)
    if (!b) return next(e)
    const rest = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const noop = () => undefined

    if (b.phase === 'failed') {
      return (
        <Box flexDirection="column">
          {rest}
          <Text dimColor wrap="truncate-end">
            <Text color={BAD}>!</Text> {b.note}
          </Text>
        </Box>
      )
    }

    if (b.phase === 'applied') {
      return (
        <Box flexDirection="column">
          {rest}
          <Box flexDirection="row" gap={1}>
            <Text wrap="truncate-end">
              <Text color={GOOD}>✓</Text>
              <Text> Effort set to </Text>
              <Text bold>{NAMES[b.level]}</Text>
              {b.from ? <Text dimColor> (was {NAMES[b.from]})</Text> : null}
              {b.why ? <Text dimColor> · {b.why}</Text> : null}
            </Text>
            <Button key="info" label="ⓘ Learn more" variant="secondary" onPress={noop} />
          </Box>
        </Box>
      )
    }

    const was = b.from ? NAMES[b.from] : 'your old level'
    return (
      <Box flexDirection="column">
        {rest}
        <Box flexDirection="column">
          <Text>
            <Text color={ACCENT}>ⓘ</Text>
            <Text bold> Claude now works at {NAMES[b.level]} effort</Text>
          </Text>
          <Text dimColor>The mod sets the level on each message before it leaves your computer.</Text>
          <Text dimColor>The effort menu next to the model name still shows {was}. Only you can move that menu: the app does not let a chat change its own menu.</Text>
          <Text dimColor>To check the sent level, look for the orange "Effort {SHORT[b.level]}" label at the bottom, or type /auto-effort-picker status.</Text>
          <Text dimColor>If you move the menu yourself, the mod follows the menu again.</Text>
          <Box flexDirection="row" gap={1}>
            <Button key="info-close" label="Got it" role="dismiss" onPress={noop} />
          </Box>
        </Box>
      </Box>
    )
  })
}
