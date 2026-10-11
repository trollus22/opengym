/* Workout screen — walks through the active session's exercises one set at a time, in the order
 * GET /api/watch/today resolved them.
 *
 * Known MVP simplifications (see docs/WATCH_APP.md): exercises run in sequence rather than
 * alternating supersets the way the phone app does, and rest duration is a fixed default
 * (90s between sets, 120s between exercises) rather than the profile's own rest-timer setting —
 * both are on-device UI choices only, they don't touch how a set is scored or how the next
 * weight is chosen (that's still the server's progression.js, untouched).
 */
import * as hmUI from '@zos/ui'
import { getDeviceInfo } from '@zos/device'
import { replace } from '@zos/router'
import { createSysTimer, stopTimer } from '@zos/timer'
import { Vibrator, VIBRATOR_SCENE_SHORT_MIDDLE, VIBRATOR_SCENE_STRONG_REMINDER } from '@zos/sensor'
import { BasePage } from '@zeppos/zml/base-page'

const { width: W } = getDeviceInfo()
const CX = W / 2
const REST_SET = 90
const REST_EXERCISE = 120

// Which two fields this mode lets you adjust, and the step each +/- tap moves by.
const FIELDS = {
  reps: [{ key: 'w', step: 1, suffix: '' }, { key: 'r', step: 1, suffix: ' reps' }],
  time: [{ key: 'sec', step: 5, suffix: 's' }, { key: 'w', step: 1, suffix: '' }],
  cardio: [{ key: 'min', step: 1, suffix: ' min' }, { key: 'speed', step: 0.5, suffix: ' km/h' }]
}

// Flatten { entries: [{ sets: [...] }] } into one step per set, each knowing its own indices.
function buildSteps(entries) {
  const steps = []
  entries.forEach((e, ei) => e.sets.forEach((s, si) => steps.push({ ei, si })))
  return steps
}

Page(
  BasePage({
    state: {
      active: null, unit: 'kg', steps: [], stepIdx: 0,
      resting: false, restTimer: null, restLeft: 0,
      w: {}, // widget refs
      vibrator: null
    },

    build() {
      const app = getApp()._options.globalData
      this.state.active = app.active
      this.state.unit = (app.today && app.today.unit) || 'kg'
      this.state.steps = buildSteps(this.state.active.entries)
      this.state.vibrator = new Vibrator()

      const w = this.state.w
      w.exName = hmUI.createWidget(hmUI.widget.TEXT, {
        x: CX - 200, y: 60, w: 400, h: 60, text_size: 30, color: 0xffffff,
        align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V, text_style: hmUI.text_style.ELLIPSIS, text: ''
      })
      w.setLabel = hmUI.createWidget(hmUI.widget.TEXT, {
        x: CX - 200, y: 120, w: 400, h: 40, text_size: 20, color: 0x999999,
        align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V, text: ''
      })

      // Field A (primary — weight for reps/time, minutes for cardio)
      w.aMinus = this.stepButton(CX - 200, 190, '−', () => this.bump(0, -1))
      w.aVal = this.valueText(CX - 110, 190)
      w.aPlus = this.stepButton(CX + 130, 190, '+', () => this.bump(0, 1))

      // Field B (secondary — reps/seconds/speed)
      w.bMinus = this.stepButton(CX - 200, 270, '−', () => this.bump(1, -1))
      w.bVal = this.valueText(CX - 110, 270)
      w.bPlus = this.stepButton(CX + 130, 270, '+', () => this.bump(1, 1))

      w.action = hmUI.createWidget(hmUI.widget.BUTTON, {
        x: CX - 150, y: 360, w: 300, h: 80, radius: 16, text_size: 30,
        normal_color: 0x2f6ff0, press_color: 0x1d4fbf, text: 'Log set',
        click_func: () => this.onAction()
      })

      this.renderStep()
    },

    stepButton(x, y, label, fn) {
      return hmUI.createWidget(hmUI.widget.BUTTON, {
        x, y, w: 70, h: 70, radius: 16, text_size: 34,
        normal_color: 0x2a2d36, press_color: 0x1c1e24, text: label,
        click_func: fn
      })
    },
    valueText(x, y) {
      return hmUI.createWidget(hmUI.widget.TEXT, {
        x, y, w: 240, h: 70, text_size: 26, color: 0xffffff,
        align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V, text: ''
      })
    },

    fields() {
      const entry = this.state.active.entries[this.currentStep().ei]
      return FIELDS[entry.mode] || FIELDS.reps
    },
    currentStep() { return this.state.steps[this.state.stepIdx] },
    currentSet() {
      const { ei, si } = this.currentStep()
      return this.state.active.entries[ei].sets[si]
    },

    renderStep() {
      const { ei, si } = this.currentStep()
      const entry = this.state.active.entries[ei]
      const w = this.state.w
      w.exName.setProperty(hmUI.prop.TEXT, entry.name)
      w.setLabel.setProperty(hmUI.prop.TEXT, `Set ${si + 1} of ${entry.sets.length}`)
      const [a, b] = this.fields()
      const set = this.currentSet()
      w.aVal.setProperty(hmUI.prop.TEXT, this.fmt(set[a.key], a) + (a.key === 'w' ? ' ' + this.state.unit : a.suffix))
      w.bVal.setProperty(hmUI.prop.TEXT, this.fmt(set[b.key], b) + (b.key === 'w' ? ' ' + this.state.unit : b.suffix))
    },
    fmt(v, field) {
      if (field.key === 'sec') { const n = Math.max(0, Math.round(v || 0)); return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0') }
      return String(Math.round((v || 0) * 10) / 10)
    },

    bump(fieldIdx, dir) {
      if (this.state.resting) return
      const field = this.fields()[fieldIdx]
      const set = this.currentSet()
      const next = Math.max(0, Math.round(((set[field.key] || 0) + dir * field.step) * 10) / 10)
      set[field.key] = next
      this.renderStep()
    },

    onAction() {
      if (this.state.resting) { this.endRest(); return }
      this.currentSet().done = true
      this.state.vibrator.setMode(VIBRATOR_SCENE_SHORT_MIDDLE)
      this.state.vibrator.start()

      const isLastStep = this.state.stepIdx === this.state.steps.length - 1
      if (isLastStep) { this.finish(); return }

      const nextEx = this.state.steps[this.state.stepIdx + 1].ei !== this.currentStep().ei
      this.startRest(nextEx ? REST_EXERCISE : REST_SET)
    },

    startRest(sec) {
      this.state.resting = true
      this.state.restLeft = sec
      const w = this.state.w
      w.action.setProperty(hmUI.prop.MORE, { x: CX - 150, y: 360, w: 300, h: 80, text: 'Skip rest — ' + sec + 's' })
      this.state.restTimer = createSysTimer(true, 1000, () => {
        this.state.restLeft -= 1
        if (this.state.restLeft <= 0) {
          this.state.vibrator.setMode(VIBRATOR_SCENE_STRONG_REMINDER)
          this.state.vibrator.start()
          this.endRest()
        } else {
          this.state.w.action.setProperty(hmUI.prop.MORE, { x: CX - 150, y: 360, w: 300, h: 80, text: 'Skip rest — ' + this.state.restLeft + 's' })
        }
      })
    },
    endRest() {
      if (this.state.restTimer != null) { stopTimer(this.state.restTimer); this.state.restTimer = null }
      this.state.resting = false
      this.state.stepIdx += 1
      this.state.w.action.setProperty(hmUI.prop.MORE, { x: CX - 150, y: 360, w: 300, h: 80, text: 'Log set' })
      this.renderStep()
    },

    finish() {
      const app = getApp()._options.globalData
      app.active.end = Date.now()
      this.state.w.action.setProperty(hmUI.prop.MORE, { x: CX - 150, y: 360, w: 300, h: 80, text: 'Saving…' })
      this.request({ method: 'LOG_WORKOUT', params: { active: app.active } }).then(r => {
        app.result = r.error ? { error: r.error, active: app.active } : { ...r.data, active: app.active }
        replace({ url: 'page/finish.page' })
      })
    },

    onDestroy() {
      if (this.state.restTimer != null) stopTimer(this.state.restTimer)
    }
  })
)
