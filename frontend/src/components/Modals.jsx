import { useEffect, useRef } from 'react'
import { useUI } from '../store/useUI.js'

// Rubberband resistance past boundaries (WWDC Designing Fluid Interfaces)
function rubberband(overshoot, dimension = 400, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot))
}

// Exponential momentum projection from release velocity
function project(initialVelocity, decelerationRate = 0.998) {
  return (initialVelocity / 1000) * decelerationRate / (1 - decelerationRate)
}

// One bottom sheet (or centered dialog) with Apple fluid swipe-to-dismiss.
function Sheet({ sheet }) {
  const { closeSheet } = useUI()
  const ref = useRef(null)
  const backRef = useRef(null)
  const drag = useRef({ startY: null, delta: 0, lastY: 0, lastTime: 0, velocity: 0 })

  const onTouchStart = e => {
    const el = ref.current
    if (e.target.closest && e.target.closest('input[type=range], [data-nodrag]')) {
      drag.current = { startY: null, delta: 0, lastY: 0, lastTime: 0, velocity: 0 }
      return
    }
    const touch = e.touches[0]
    const now = performance.now()
    drag.current = {
      startY: el.scrollTop <= 0 ? touch.clientY : null,
      delta: 0,
      lastY: touch.clientY,
      lastTime: now,
      velocity: 0,
    }
  }

  const onTouchMove = e => {
    const el = ref.current, d = drag.current
    if (d.startY === null) return
    const touch = e.touches[0]
    const now = performance.now()
    const dt = now - d.lastTime
    if (dt > 8) {
      d.velocity = ((touch.clientY - d.lastY) / dt) * 1000
      d.lastY = touch.clientY
      d.lastTime = now
    }
    const rawDelta = touch.clientY - d.startY
    if (el.scrollTop <= 0) {
      e.preventDefault()
      el.style.transition = 'none'
      if (rawDelta < 0) {
        // Rubberband resistance when pulling up at top
        d.delta = rubberband(rawDelta)
      } else {
        d.delta = rawDelta
      }
      el.style.transform = `translateY(${d.delta}px)`
      if (backRef.current) {
        backRef.current.style.transition = 'none'
        const opacity = Math.max(0, 1 - (d.delta / 420))
        backRef.current.style.opacity = `${opacity}`
      }
    } else {
      d.delta = 0
    }
  }

  const onTouchEnd = () => {
    const el = ref.current, d = drag.current
    if (d.startY === null) return
    const projectedEndpoint = d.delta + project(d.velocity, 0.998)
    const shouldDismiss = (projectedEndpoint > 140 || d.delta > 120 || d.velocity > 550) && !sheet.locked

    if (shouldDismiss) {
      el.style.transition = 'transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)'
      el.style.transform = 'translateY(110%)'
      if (backRef.current) {
        backRef.current.style.transition = 'opacity 0.24s ease'
        backRef.current.style.opacity = '0'
      }
      setTimeout(() => closeSheet(sheet.id), 260)
    } else {
      // Critically damped spring return
      el.style.transition = 'transform 0.36s cubic-bezier(0.32, 0.72, 0, 1)'
      el.style.transform = ''
      if (backRef.current) {
        backRef.current.style.transition = 'opacity 0.36s cubic-bezier(0.32, 0.72, 0, 1)'
        backRef.current.style.opacity = '1'
      }
    }
    d.startY = null
  }

  // non-passive touchmove so preventDefault works
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [])

  const close = () => closeSheet(sheet.id)
  if (sheet.kind === 'center') {
    return (
      <div>
        <div ref={backRef} className="mback" onClick={() => { if (!sheet.locked) close() }} />
        <div className="center">{sheet.render(close)}</div>
      </div>
    )
  }
  return (
    <div>
      <div ref={backRef} className="mback" onClick={() => { if (!sheet.locked) close() }} />
      <div className="sheet" ref={ref} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="grab" />
        {sheet.render(close)}
      </div>
    </div>
  )
}

export default function Modals() {
  const sheets = useUI(s => s.sheets)

  // lock the page behind any open sheet (iOS-safe)
  useEffect(() => {
    if (!sheets.length) return
    const y = window.scrollY || 0
    const b = document.body.style
    b.position = 'fixed'; b.top = -y + 'px'; b.left = '0'; b.right = '0'; b.width = '100%'
    return () => {
      b.position = b.top = b.left = b.right = b.width = ''
      window.scrollTo(0, y)
    }
  }, [sheets.length > 0])

  if (!sheets.length) return null
  return (
    <div id="modal-root" className="open">
      {sheets.map(s => <Sheet key={s.id} sheet={s} />)}
    </div>
  )
}
