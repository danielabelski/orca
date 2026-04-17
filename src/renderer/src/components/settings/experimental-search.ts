import type { SettingsSearchEntry } from './settings-search'

export const EXPERIMENTAL_PANE_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  {
    title: 'Persistent terminal sessions',
    description:
      'Keeps terminal sessions alive across app restarts via a background daemon. Experimental — some sessions may become unresponsive.',
    keywords: [
      'experimental',
      'terminal',
      'daemon',
      'persistent',
      'background',
      'sessions',
      'restart',
      'scrollback',
      'reattach'
    ]
  }
]
