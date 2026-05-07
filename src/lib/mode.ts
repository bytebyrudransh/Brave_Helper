/**
 * V3.0 mode state machine.
 *
 * Two mutually-exclusive modes:
 *
 *   RESEARCH (default):
 *     - vault: locked
 *     - page reading: enabled
 *     - web search / URL fetch: enabled (when wired in Phase 4)
 *     - screenshots: enabled
 *     - memory recall: enabled
 *
 *   AUTOFILL (opt-in):
 *     - vault: unlocked
 *     - page reading: enabled (the form being filled)
 *     - web search / URL fetch: DISABLED
 *     - screenshots: enabled
 *
 * The only safety-relevant transition is between these two: when the vault
 * unlocks, web access must be cut. When the vault locks, web access can come
 * back. Everything else (page reading, screenshots, recall) is composable
 * and runs together by default.
 *
 * The mode is derived from a single source of truth — whether the vault is
 * currently unlocked. Keeping it derived (not a separate stored flag) makes
 * accidental drift impossible.
 */

export type AppMode = 'research' | 'autofill';

export const MODE_LABELS: Record<AppMode, string> = {
  research: 'RESEARCH',
  autofill: 'AUTOFILL',
};

export const MODE_DESCRIPTIONS: Record<AppMode, string> = {
  research:
    'Default. Page reading, web search, screenshots, memory recall. Vault locked.',
  autofill:
    'Vault unlocked for autofill. Web access cut. Page reading on for the current form.',
};

/**
 * Derive the current mode from vault state.
 * If the vault is unlocked, we're in Autofill mode. Otherwise Research.
 */
export function deriveMode(vaultUnlocked: boolean): AppMode {
  return vaultUnlocked ? 'autofill' : 'research';
}

/**
 * Capabilities granted in each mode. Used to gate features at runtime.
 */
export interface ModeCapabilities {
  pageReading: boolean;
  vaultAccess: boolean;
  webSearch: boolean;
  urlFetch: boolean;
  screenshots: boolean;
  memoryRecall: boolean;
}

export function capabilitiesFor(mode: AppMode): ModeCapabilities {
  switch (mode) {
    case 'research':
      return {
        pageReading: true,
        vaultAccess: false,
        webSearch: true,
        urlFetch: true,
        screenshots: true,
        memoryRecall: true,
      };
    case 'autofill':
      return {
        pageReading: true,
        vaultAccess: true,
        webSearch: false,
        urlFetch: false,
        screenshots: true,
        memoryRecall: true,
      };
  }
}
