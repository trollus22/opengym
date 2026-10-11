// Tiny dependency-free i18n. English source strings are the keys; locale files in
// src/locales/ map them to translations and are lazy-loaded (Vite code-splits each
// import.meta.glob entry), so the initial bundle stays English-only.
// Exercise instructions come from separately generated packs in src/instr/ (one per
// language, from the upstream dataset) — also lazy-loaded on language switch.
//
// No React import here on purpose: api/ imports this file straight from plain Node for the
// watch app (see docs/WATCH_APP.md), and a backend has no business pulling in a UI framework.
// The one React hook this module used to export lives in useLang.js instead — see subscribeLang
// below.

// UI languages. de/pt have no instruction pack upstream — instructions fall back to English.
export const LANGS = {
  en: 'English', de: 'Deutsch', es: 'Español', fr: 'Français', it: 'Italiano',
  pt: 'Português', pl: 'Polski', tr: 'Türkçe', ru: 'Русский', zh: '中文',
  ko: '한국어', hi: 'हिन्दी'
}
export const INSTR_LANGS = ['en', 'es', 'fr', 'it', 'tr', 'ru', 'zh', 'hi', 'pl', 'ko']
const DATE_LOCALES = {
  en: 'en-GB', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', pt: 'pt-PT',
  pl: 'pl-PL', tr: 'tr-TR', ru: 'ru-RU', zh: 'zh-CN', ko: 'ko-KR', hi: 'hi-IN'
}

// import.meta.glob is a Vite build-time macro — it doesn't exist outside a Vite bundle (e.g.
// when api/ imports the pure lib files under it, such as progression.js, from plain Node for
// the watch app). Guarded so the module graph stays importable there; nothing calls setLang()
// outside the browser, so the empty fallback is never actually read.
const localePacks = typeof import.meta.glob === 'function' ? import.meta.glob('../locales/*.js') : {}
const instrPacks = typeof import.meta.glob === 'function' ? import.meta.glob('../instr/*.js') : {}

let lang = 'en'
let dict = {}
let instr = null            // { exId: [steps] } for the current language, null = English
let version = 0
const subs = new Set()
const notify = () => { version++; subs.forEach(f => f()) }

export const getLang = () => lang
export const dateLocale = () => DATE_LOCALES[lang] || 'en-GB'

// Translate a source string; {0},{1}… are replaced with args (also on the English fallback).
export function t(s, ...args) {
  let v = dict[s] || s
  for (let i = 0; i < args.length; i++) v = v.replaceAll('{' + i + '}', args[i])
  return v
}
// Instructions for an exercise in the current language (English steps as fallback).
export const instrFor = ex => (instr && instr[ex.id]) || ex.st || []

export async function setLang(l) {
  if (!LANGS[l]) l = 'en'
  if (l === lang && version > 0) return
  lang = l
  try {
    dict = l === 'en' ? {} : (await localePacks['../locales/' + l + '.js']()).default
    instr = l === 'en' || !INSTR_LANGS.includes(l) ? null : (await instrPacks['../instr/' + l + '.js']()).default
  } catch (e) { dict = {}; instr = null }
  notify()
}

// Plain subscribe/version pair for useLang.js's useSyncExternalStore — kept as functions here
// (rather than exporting `subs`/`version` directly) so this module's only public surface is
// functions, same as everything else in it.
export const subscribeLang = fn => { subs.add(fn); return () => subs.delete(fn) }
export const langVersion = () => version
