import type { ConfigRow, EngineInterface, Register, SessionMessage } from 'claude-code'

import type { Band, Level } from '../types'

const BAND = { plugin: 'auto-effort-picker', key: 'band' } as const
const OVERRIDE = { plugin: 'auto-effort-picker', key: 'override' } as const
// Fits the footer slot (about 14 cells).
const SHORT = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', max: 'Max' } as const

const LEVELS: readonly Level[] = ['low', 'medium', 'high', 'xhigh', 'max']
const NAMES: Record<Level, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }

const APPLIED_MS = 15000
const ACCENT = '#d97757'
const GOOD = '#16a34a'
const BAD = '#dc2626'

type Mode = 'suggest' | 'auto'
type Pick = { level: Level; why: string }

// Module variables reset on a reload; the band and the override live in $.state.
let home = ''
let enabled = true
let mode: Mode = 'suggest'
// Bumped on every prompt, so a slow pick for an older prompt is dropped.
let gen = 0
let nextId = 1
// The level the main chat's last request ran at, before this mod touched it.
let seen: Level | '' = ''
// The level for the rest of the running turn, set by a Switch or by auto mode.
let turnLevel: Level | null = null
// The /config row that holds the effort setting, found at session start.
let rowKey = ''
// A /effort run waiting for the turn to end.
// The level the mod puts on requests, and the picker level it saw when it took over.
let hold: { level: Level; base: string } | null = null
let lastEffort = ''
// The prompt waiting for its pick at the turn's first request.
let held: { text: string; mine: number } | null = null

// The prompt is a /ticket run: the pick waits for the ticket text from YouTrack.
let ticketWait: number | null = null
const TICKET_TOOL = 'mcp__youtrack__get_issue'
// The same /ticket run: the approved plan picks again, for the build.
let planWait: number | null = null
// An epic is a choice, not the work: the pick waits for the sub-ticket the run moves to In Progress.
let epicId = ''
let loaded = new Map<string, string>()

// The prompt is a /repo-security-hardening run: the pick judges the review, the approved plan picks again for the build.
// The run spans several prompts (stop 1, selection round), so its plan approval waits until it comes or another run starts.
const SECURITY = /^\/repo-security-hardening\b/i
let securityRun = false
const securityText = (args: string) => `A security review of this repository by the repo-security-hardening skill: inventory, dependency and secret scans, static analysis, attack surface review, and a rated findings report. It runs in plan mode until the user approves the selected changes. Judge the review work.${args ? `\nArguments: ${args}` : ''}`

async function pickTicket($: EngineInterface, ticket: string, mine: number) {
  ticketWait = null
  loaded = new Map()
  const text = `A ticket to work through, loaded from YouTrack:\n${ticket}`
  if (mode === 'auto') await autoAdjust($, text, mine).catch(err => log($, 'ticket auto', err))
  else await suggest($, text, mine).catch(err => log($, 'ticket suggest', err))
}

// The status line script reads "<level sent> <picker level>" per session id from one JSON file.
// $.fs cannot delete, so ended and day-old sessions are dropped from the file instead.
// shortcut: two sessions writing at the same moment can drop each other's entry, lock if that shows up.
const DAY_MS = 86_400_000
let lastStatus = ''
async function editStatus($: EngineInterface, fn: (m: Record<string, { line: string; at: number }>) => void) {
  const path = `${home}/.claude/mods-state/auto-effort-picker.json`
  try {
    const m = (await $.fs.exists(path)) ? (JSON.parse(String(await $.fs.read(path))) as Record<string, { line: string; at: number }>) : {}
    fn(m)
    await $.fs.write(path, JSON.stringify(m))
  } catch (err) {
    await log($, 'status file', err)
  }
}

async function writeStatus($: EngineInterface, sent: string, picker: string) {
  const line = `${sent} ${picker}`
  if (line === lastStatus) return
  lastStatus = line
  const id = await $.session.id()
  const now = await $.clock.now()
  await editStatus($, m => {
    for (const k of Object.keys(m)) if (now - (m[k]?.at ?? 0) > DAY_MS) delete m[k]
    m[id] = { line, at: now }
  })
}

// plugin.root may carry backslashes on Windows, and a directory install lies outside ~/.claude.
// ponytail: home guessed from the path, no engine API gives it; a root outside the user folder logs beside the plugin.
function homeOf($: EngineInterface) {
  const r = $.plugin.root
  const m = /^(.*?)[\\/]\.claude[\\/]/.exec(r) ?? /^(.*?[\\/](?:Users|home)[\\/][^\\/]+)/i.exec(r)
  return m?.[1] ?? r
}

// The /mods switchboard turns this mod off in every chat with switches.json.
const NAME = 'auto-effort-picker'
let off = false

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
  if (off) turnLevel = null
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // The next state change redraws anyway.
  }
}

async function log($: EngineInterface, what: string, err: unknown) {
  try {
    const path = `${home}/.claude/mods-logs/auto-effort-picker.log`
    const old = (await $.fs.exists(path)) ? String(await $.fs.read(path)) : ''
    const msg = err instanceof Error ? err.message : String(err)
    await $.fs.write(path, `${old.slice(-20_000)}${new Date(await $.clock.now()).toISOString()} ${what}: ${msg}\n`)
  } catch {
    // Nowhere left to report it.
  }
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

function isEffortRow(r: ConfigRow) {
  if (!/effort/i.test(`${r.key} ${r.label}`)) return false
  if (r.kind !== 'choice') return false
  return (r.options ?? []).some(o => norm(o) === 'high')
}

async function findRow($: EngineInterface) {
  const rows = await $.config.list()
  return rows.find(isEffortRow) ?? null
}

// The level the chat runs at now: the last request's, else the setting's.
async function currentLevel($: EngineInterface): Promise<Level | ''> {
  if (seen) return seen
  try {
    const row = await findRow($)
    return row ? asLevel(row.value) : ''
  } catch {
    return ''
  }
}

// Sets the chat's effort setting, or, when no setting takes it, has this mod put the level on every request
// until the person moves the picker. No /effort command is run.
async function applyLevel($: EngineInterface, level: Level) {
  turnLevel = level
  let note = ''
  try {
    const row = await findRow($)
    const option = row?.options?.find(o => norm(o) === level)
    if (row && option && !row.isLocked) {
      const r = await $.config.set({ key: row.key, value: option })
      if (!r.deny) {
        await $.state.set(OVERRIDE, null)
        return ''
      }
      note = r.deny
    } else {
      note = row ? (row.isLocked ? 'the effort setting is locked' : 'the effort setting has no such level') : 'no effort setting found'
    }
  } catch (err) {
    note = err instanceof Error ? err.message : String(err)
  }
  await log($, 'set effort', note)
  hold = { level, base: lastEffort }
  await $.state.set(OVERRIDE, level)
  redraw($)
  return ''
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
If the prompt is a ticket, judge the work the ticket asks for, not the interview and planning before it.
If the prompt only approves, answers a question, or says to go on with earlier work (yes, go, ok, do it, option 2), answer keep.

The chat runs at: ${now || 'unknown'}

Claude's last reply (first 600 characters, for context):
<reply>
${lastReply || '(none, this is the first prompt)'}
</reply>

The new prompt:
<prompt>
${text}
</prompt>

Reply with JSON only: {"level": "low|medium|high|xhigh|max|keep", "why": "the reason in under 12 plain words"}`
}

function parsePick(text: string): Pick | null {
  const m = /\{[\s\S]*\}/.exec(text)
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as { level?: unknown; why?: unknown }
    const level = asLevel(j.level)
    if (!level) return null
    return { level, why: cleanWhy(typeof j.why === 'string' ? j.why : '') }
  } catch {
    return null
  }
}

async function pick($: EngineInterface, text: string, now: Level | ''): Promise<Pick | null> {
  const messages = await $.session.messages()
  const lastReply = lastAssistantText(messages).slice(0, 600)
  const r = await $.model.complete({
    model: 'claude-sonnet-5-5',
    // Tickets and plans run long; the small pick reads all of a normal one.
    prompt: pickPrompt(text.slice(0, 40_000), lastReply, now),
    maxTokens: 120,
    effort: 'low',
    timeoutMs: 20_000,
  })
  if (!r.isAnswered) throw new Error(`pick failed: ${r.reason}`)
  return parsePick(r.text)
}

async function hideLater($: EngineInterface, id: number) {
  await $.clock.sleep(APPLIED_MS)
  const b = await getBand($)
  if (b && b.id === id && b.phase === 'applied') await setBand($, null)
}

async function showApplied($: EngineInterface, p: Pick, from: Level | '', note: string) {
  const id = nextId++
  await setBand($, { phase: 'applied', id, level: p.level, from, why: p.why, note })
  void hideLater($, id).catch(err => log($, 'hide', err))
}

// Suggest mode: pick before the prompt goes in and, when the level differs, hold the prompt until the person answers.
async function suggest($: EngineInterface, text: string, mine: number) {
  const now = await currentLevel($)
  try {
    await $.ui.status('checking effort…')
  } catch {
    // The status line is a nicety.
  }
  let p: Pick | null = null
  try {
    p = await pick($, text, now)
  } finally {
    try {
      await $.ui.status(undefined)
    } catch {
      // Nothing to clear.
    }
  }
  if (!p || mine !== gen || p.level === now) return
  const go = `Switch to ${NAMES[p.level]}`
  const auto = 'Switch, and auto-adjust from now'
  const keep = now ? `Keep ${NAMES[now]}` : 'Keep it as it is'
  let answer = ''
  try {
    answer = await $.ui.ask(`This looks like a ${NAMES[p.level]} effort task${p.why ? `: ${p.why}` : ''}. Switch before Claude starts?`, {
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
  const note = await applyLevel($, p.level)
  await showApplied($, p, now, note)
}

// Auto mode: pick before the prompt goes in, so the first request already runs at the right level.
async function autoAdjust($: EngineInterface, text: string, mine: number) {
  const now = await currentLevel($)
  try {
    await $.ui.status('picking effort…')
  } catch {
    // The status line is a nicety.
  }
  try {
    const p = await pick($, text, now)
    if (!p || mine !== gen) return
    if (p.level === now) {
      turnLevel = p.level
      return
    }
    const note = await applyLevel($, p.level)
    await showApplied($, p, now, note)
  } finally {
    try {
      await $.ui.status(undefined)
    } catch {
      // Nothing to clear.
    }
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    home = homeOf($)
    await $.command.register({
      name: 'auto-effort-picker',
      description: 'Auto Effort Picker. auto: set effort by itself. suggest: offer a switch. off or on',
      argumentHint: '[auto|suggest|off|on]',
    })
    enabled = (await $.store.get('enabled')) !== false
    mode = (await $.store.get('mode')) === 'auto' ? 'auto' : 'suggest'
    await readSwitch($).catch(() => undefined)
    $.clock.every(3000, () => {
      void readSwitch($).catch(() => undefined)
    })
    void (async () => {
      const row = await findRow($)
      rowKey = row?.key ?? ''
      await log($, 'effort row', row ? `${row.key} = ${String(row.value)} [${(row.options ?? []).join(', ')}]${row.isLocked ? ' locked' : ''}` : 'none found')
    })().catch(err => log($, 'find row', err))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (off || !enabled) return next(e)
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return next(e)
    const text = e.text.trim()
    const isTicket = /^\/ticket\b/i.test(text)
    const isSecurity = SECURITY.test(text)
    if (!text || (text.startsWith('/') && !isTicket && !isSecurity)) return next(e)
    if (isTicket || isSecurity) securityRun = isSecurity
    gen += 1
    turnLevel = null
    ticketWait = null
    planWait = null
    epicId = ''
    loaded = new Map()
    const mine = gen
    // A new prompt makes an unanswered offer stale.
    const b = await getBand($).catch(() => null)
    if (b?.phase === 'offer') await setBand($, null).catch(() => undefined)
    // The pick waits for the turn's first request, which carries the level the chat really runs at.
    if (isTicket) ticketWait = planWait = mine
    else held = { text: isSecurity ? securityText(text.replace(SECURITY, '').trim()) : text, mine }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Every main-chat request: note its level, and put the chosen one on it when the setting could not be changed.
  on('turn.step', async function* ($, e, next) {
    if (off || e.agentId !== undefined || typeof e.effort !== 'string') return yield* next(e)
    lastEffort = e.effort
    // The picker moved (by hand, or /effort landed): the mod lets go.
    if (hold && e.effort !== hold.base) { hold = null; turnLevel = null }
    let value: Level | null = enabled && hold ? hold.level : null
    if (!hold && (await $.state.get(OVERRIDE)).value) {
      await $.state.set(OVERRIDE, null)
      redraw($)
    }
    // What the chat runs at now: the level the mod holds, else the picker's.
    seen = value ?? (asLevel(e.effort) || seen)
    if (held && e.index === 0 && enabled) {
      const h = held
      held = null
      if (mode === 'auto') await autoAdjust($, h.text, h.mine).catch(err => log($, 'auto', err))
      else await suggest($, h.text, h.mine).catch(err => log($, 'suggest', err))
      value = enabled && hold ? hold.level : null
    }
    const want = turnLevel ?? (enabled ? (value ?? null) : null)
    await writeStatus($, want ?? e.effort, e.effort)
    if (!want || want === e.effort) return yield* next(e)
    void log($, 'request', `${e.effort} -> ${want}`)
    return yield* next({ ...e, effort: want })
  })

  // /ticket: pick from the first ticket the main chat loads, then hold that level for the rest of the turn.
  // An epic waits: its sub-tickets are kept until the run moves the chosen one to In Progress.
  on('tool.call', { tool: TICKET_TOOL }, async ($, e, next) => {
    const r = await next(e)
    if (off || !enabled || ticketWait === null || ticketWait !== gen || e.agentId !== undefined) return r
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
    await pickTicket($, r.text, ticketWait)
    return r
  }).catch(($, e, next) => next(e))

  // The epic's chosen sub-ticket goes to In Progress (ticket.md step 1a): pick from its loaded text.
  on('tool.call', { tool: 'mcp__youtrack__update_issue' }, async ($, e, next) => {
    const r = await next(e)
    if (off || !enabled || !epicId || ticketWait === null || ticketWait !== gen || e.agentId !== undefined) return r
    if (r.deny || r.isError) return r
    const id = typeof e.issueId === 'string' ? e.issueId : ''
    const state = (e.customFields as { State?: unknown } | undefined)?.State
    const ticket = loaded.get(id)
    if (id === epicId || state !== 'In Progress' || !ticket) return r
    await pickTicket($, ticket, ticketWait)
    return r
  }).catch(($, e, next) => next(e))

  // /ticket and /repo-security-hardening: the approved plan sets the level for the build; the first pick covered planning.
  // A rejected plan comes back as an error, so the next ExitPlanMode tries again.
  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    const r = await next(e)
    if (off || !enabled || e.agentId !== undefined) return r
    if (!securityRun && (planWait === null || planWait !== gen)) return r
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
    await editStatus($, m => {
      delete m[e.sessionId]
    })
    lastStatus = ''
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
            : 'Auto Effort Picker: suggest. When a prompt needs another level, a Switch button shows above the prompt.',
      }
    }
    if (arg === 'off' || arg === 'on') {
      enabled = arg === 'on'
      await $.store.set('enabled', enabled)
      if (!enabled) {
        turnLevel = null
        await $.state.set(OVERRIDE, null)
        await setBand($, null)
      }
      return { text: enabled ? `Auto Effort Picker is on (${mode}).` : 'Auto Effort Picker is off. Type /auto-effort-picker on to turn it back on.' }
    }
    const now = await currentLevel($)
    const { value } = await $.state.get(OVERRIDE)
    return {
      text: [
        `Auto Effort Picker is ${enabled ? 'on' : 'off'}, mode: ${mode}.`,
        `This chat runs at: ${now ? NAMES[now] : 'unknown yet'}${value ? ` (held by the mod: ${NAMES[value]})` : ''}.`,
        `Effort setting: ${rowKey || 'not found, the mod sets the level on each request'}.`,
        'Type /auto-effort-picker auto, suggest, off or on.',
      ].join('\n'),
    }
  })

  on('ui.press', { plugin: 'auto-effort-picker', element: 'switch' }, async ($, e) => {
    const b = await getBand($)
    if (!b || b.phase !== 'offer') return { element: e.element }
    try {
      const note = await applyLevel($, b.level)
      await showApplied($, { level: b.level, why: b.why }, b.from, note)
    } catch (err) {
      await log($, 'switch', err)
      await setBand($, { ...b, note: `Could not switch: ${(err instanceof Error ? err.message : String(err)).slice(0, 100)}` })
    }
    return { element: e.element }
  })

  on('ui.press', { plugin: 'auto-effort-picker', element: 'auto' }, async ($, e) => {
    mode = 'auto'
    await $.store.set('mode', mode)
    const b = await getBand($)
    if (b?.phase === 'offer') {
      const note = await applyLevel($, b.level).catch(err => String(err))
      await showApplied($, { level: b.level, why: 'Auto-adjust is on for every prompt' }, b.from, note)
    }
    return { element: e.element }
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

  on('ui.press', { plugin: 'auto-effort-picker', element: 'skip' }, async ($, e) => {
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

    if (b.phase === 'info') {
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
            <Text dimColor>To check the real level, look for the orange "Effort {SHORT[b.level]}" label at the bottom, or type /auto-effort-picker.</Text>
            <Text dimColor>If you move the menu yourself, the mod follows the menu again.</Text>
            <Box flexDirection="row" gap={1}>
              <Button key="info-close" label="Got it" role="dismiss" onPress={noop} />
            </Box>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {rest}
        <Box flexDirection="column">
          <Text>
            <Text color={ACCENT}>●</Text>
            <Text bold> This looks like a {NAMES[b.level]} effort task</Text>
            {b.from ? <Text dimColor> (you are on {NAMES[b.from]})</Text> : null}
          </Text>
          {b.why ? <Text dimColor>{b.why}</Text> : null}
          <Box flexDirection="row" gap={1}>
            <Button key="switch" label={`Switch to ${NAMES[b.level]}`} variant="primary" onPress={noop} />
            <Button key="auto" label="Auto-adjust every prompt" variant="secondary" onPress={noop} />
            <Button key="skip" label="Skip" role="dismiss" onPress={noop} />
          </Box>
          {b.note ? <Text color={BAD}>{b.note}</Text> : null}
        </Box>
      </Box>
    )
  })
}
