/* Today screen — what GET /api/watch/today resolved for the current local date, with a Start
 * button that hands off to the session page. See docs/WATCH_APP.md for the overall flow.
 */
import * as hmUI from '@zos/ui'
import { getDeviceInfo } from '@zos/device'
import { push } from '@zos/router'
import { BasePage } from '@zeppos/zml/base-page'

const { width: W } = getDeviceInfo()
const CX = W / 2

function todayISO() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

Page(
  BasePage({
    state: { title: null, sub: null, action: null, today: null },

    build() {
      this.state.title = hmUI.createWidget(hmUI.widget.TEXT, {
        x: CX - 200, y: 160, w: 400, h: 80,
        text_size: 32, color: 0xffffff,
        align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V,
        text_style: hmUI.text_style.WRAP,
        text: 'Loading…'
      })
      this.state.sub = hmUI.createWidget(hmUI.widget.TEXT, {
        x: CX - 200, y: 240, w: 400, h: 60,
        text_size: 22, color: 0x999999,
        align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V,
        text_style: hmUI.text_style.WRAP,
        text: ''
      })
      this.state.action = hmUI.createWidget(hmUI.widget.BUTTON, {
        x: CX - 130, y: 320, w: 260, h: 80,
        radius: 16, text_size: 30,
        normal_color: 0x2f6ff0, press_color: 0x1d4fbf,
        text: '',
        click_func: () => this.onAction()
      })
      this.fetchToday()
    },

    fetchToday() {
      this.request({ method: 'GET_TODAY', params: { date: todayISO() } }).then(r => {
        if (r.error) {
          this.state.title.setProperty(hmUI.prop.TEXT, 'Not connected')
          this.state.sub.setProperty(hmUI.prop.TEXT, r.error)
          this.state.action.setProperty(hmUI.prop.MORE, { x: CX - 130, y: 320, w: 260, h: 80, text: 'Open Zepp app to sign in' })
          this.state.today = null
          return
        }
        this.state.today = r.data
        if (r.data.rest) {
          this.state.title.setProperty(hmUI.prop.TEXT, 'Rest day')
          this.state.sub.setProperty(hmUI.prop.TEXT, 'Nothing planned today')
          this.state.action.setProperty(hmUI.prop.MORE, { x: CX - 130, y: 320, w: 260, h: 80, text: '' })
          return
        }
        this.state.title.setProperty(hmUI.prop.TEXT, (r.data.emoji ? r.data.emoji + ' ' : '') + r.data.name)
        this.state.sub.setProperty(hmUI.prop.TEXT, r.data.entries.length + (r.data.entries.length === 1 ? ' exercise' : ' exercises'))
        this.state.action.setProperty(hmUI.prop.MORE, { x: CX - 130, y: 320, w: 260, h: 80, text: 'Start' })
      })
    },

    onAction() {
      const today = this.state.today
      if (!today || today.rest) return
      const app = getApp()._options.globalData
      app.today = today
      app.active = {
        id: 'w' + Date.now().toString(36),
        d: todayISO(),
        start: Date.now(),
        end: null,
        routineId: today.routineId,
        name: today.name,
        bw: null,
        entries: today.entries.map(e => ({
          id: e.id, name: e.name, mode: e.mode, target: e.target,
          sets: e.sets.map(s => ({ ...s })),
          topW: null
        }))
      }
      push({ url: 'page/session.page' })
    }
  })
)
