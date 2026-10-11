// Split out of i18n.js so that file can stay React-free (api/ imports it from plain Node for
// the watch app — see docs/WATCH_APP.md). This is the only piece that needs React.
import { useSyncExternalStore } from 'react'
import { subscribeLang, langVersion } from './i18n.js'

// Re-renders the subscribing component (and its children) whenever the language changes.
export function useLang() {
  return useSyncExternalStore(subscribeLang, langVersion)
}
