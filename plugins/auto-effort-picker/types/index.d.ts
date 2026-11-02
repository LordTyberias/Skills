export type Level = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type Band = {
  /** applied: one line for a few seconds. failed: the pick failed, one line for a few seconds. info: the Learn more panel, open until closed. */
  phase: 'applied' | 'failed' | 'info'
  /** Changes with every new band, so an old timer never clears a newer one. */
  id: number
  /** The level the framework picked. */
  level: Level
  /** The level the chat ran at when the prompt went in. */
  from: Level | ''
  /** One short reason, from the framework. */
  why: string
  /** Why the mod sets the level on each request, or the failed pick's message; empty when the setting changed. */
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    'auto-effort-picker': {
      band: Band | null
      /** The level the mod puts on every main-chat request when the effort setting could not be changed. */
      override: Level | null
    }
  }
}
