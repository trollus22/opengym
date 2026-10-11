/* Summary screen after a workout is logged (or failed to log) — see docs/WATCH_APP.md.
 * No offline queue in this MVP: a failed POST /api/watch/log can be retried from here (the
 * finished workout stays in memory until you leave this screen), but leaving without a
 * successful sync loses it, same as closing the phone app mid-sync would.
 */
import * as hmUI from '@zos/ui'
import { getDeviceInfo } from '@zos/device'
import { replace } from '@zos/router'
import { BasePage } from '@zeppos/zml/base-page'

const { width: W } = getDeviceInfo()
const CX = W / 2

function fmtDur(ms) {
  const m = Math.floor(ms / 60000)
  return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + ' min'
}

Page(
  BasePage({
    state: { result: null },

    build() {
      const app = getApp()._options.globalData
      this.state.result = app.result

      const title = hmUI.createWidget(hmUI.widget.TEXT, {
        x: CX - 200, y: 100, w: 400, h: 60, text_size: 32, color: 0xffffff,
        align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V,
        text: this.state.result && this.state.result.error ? 'Could not save' : 'Workout saved'
      })

      if (this.state.result && this.state.result.error) {
        hmUI.createWidget(hmUI.widget.TEXT, {
          x: CX - 200, y: 170, w: 400, h: 100, text_size: 20, color: 0xe5484d,
          align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V, text_style: hmUI.text_style.WRAP,
          text: this.state.result.error
        })
        hmUI.createWidget(hmUI.widget.BUTTON, {
          x: CX - 150, y: 300, w: 300, h: 70, radius: 16, text_size: 26,
          normal_color: 0x2f6ff0, press_color: 0x1d4fbf, text: 'Retry',
          click_func: () => this.retry()
        })
        hmUI.createWidget(hmUI.widget.BUTTON, {
          x: CX - 150, y: 380, w: 300, h: 70, radius: 16, text_size: 24,
          normal_color: 0x2a2d36, press_color: 0x1c1e24, text: 'Discard & go back',
          click_func: () => this.leave()
        })
        return
      }

      const w = this.state.result || {}
      const a = w.active || {}
      const vol = (w.workout && w.workout.vol) || 0
      const prs = (w.prs || []).length
      const rows = [
        ['Duration', fmtDur((a.end || Date.now()) - (a.start || Date.now()))],
        ['Volume', String(Math.round(vol))],
        ['PRs', prs ? String(prs) : '—']
      ]
      rows.forEach((r, i) => {
        hmUI.createWidget(hmUI.widget.TEXT, {
          x: CX - 180, y: 190 + i * 50, w: 200, h: 40, text_size: 22, color: 0x999999,
          align_h: hmUI.align.LEFT, align_v: hmUI.align.CENTER_V, text: r[0]
        })
        hmUI.createWidget(hmUI.widget.TEXT, {
          x: CX + 0, y: 190 + i * 50, w: 180, h: 40, text_size: 22, color: 0xffffff,
          align_h: hmUI.align.RIGHT, align_v: hmUI.align.CENTER_V, text: r[1]
        })
      })

      hmUI.createWidget(hmUI.widget.BUTTON, {
        x: CX - 150, y: 360, w: 300, h: 80, radius: 16, text_size: 28,
        normal_color: 0x2f6ff0, press_color: 0x1d4fbf, text: 'Nice!',
        click_func: () => this.leave()
      })
    },

    retry() {
      const app = getApp()._options.globalData
      this.request({ method: 'LOG_WORKOUT', params: { active: app.active } }).then(r => {
        app.result = r.error ? { error: r.error, active: app.active } : { ...r.data, active: app.active }
        replace({ url: 'page/finish.page' })
      })
    },

    leave() {
      const app = getApp()._options.globalData
      app.active = null
      app.result = null
      replace({ url: 'page/today.page' })
    }
  })
)
