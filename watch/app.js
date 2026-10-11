import { BaseApp } from '@zeppos/zml/base-app'

App(
  BaseApp({
    // Shared between page/*.page.js (all in one process, unlike app-side which is a separate
    // one on the phone) — the resolved plan from GET /api/watch/today, and the in-progress
    // workout the session page fills in as sets are logged. Nothing here is persisted; a killed
    // app just loses the in-progress session, same as the web app's S.active (device-local only,
    // never synced until POST /api/watch/log — see docs/WATCH_APP.md).
    globalData: {
      today: null,
      active: null,
      result: null
    },
    onCreate() {
      console.log('openGym onCreate')
    },
    onDestroy() {
      console.log('openGym onDestroy')
    }
  })
)
