export type Level = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

declare module 'claude-code' {
  interface PluginState {
    'auto-effort-picker': {
      /** The level auto-effort-picker puts on every main-chat request, or null. */
      override: Level | null
    }
  }
}
