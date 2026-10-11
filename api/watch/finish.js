/* Turns a workout the watch just ran into the same S.workouts entry shape the web app builds,
 * using the same PR/volume/1RM logic — see api/watch/plan.js for why this imports rather than
 * re-implements. Mirrors the pure parts of doFinishWorkout (frontend/sheets.jsx:915-945); what's
 * left out is UI only (sounds, the finish sheet, the "finish early?" confirmation — the watch
 * handles those on-device before it ever calls this).
 */
import { bestWeightFor, workoutVolume } from '../../frontend/src/lib/history.js';
import { is1RMRecord } from '../../frontend/src/lib/onerm.js';

/** `active` is what the watch built locally: { id, d, start, end, routineId, name, bw,
 *  entries: [{ id, sets, topW, target }] } — sets/target exactly as handed out by
 *  GET /api/watch/today and filled in on-device as sets were logged.
 *  Mutates `state` (pushes the workout, updates exWeights) and returns the workout it built. */
export function finalizeWorkout(state, active) {
  const S = state;
  S.workouts = S.workouts || [];
  S.exWeights = S.exWeights || {};

  const entries = (active.entries || [])
    .map(e => ({ id: e.id, sets: e.sets || [], topW: e.topW || null, target: e.target || null }))
    .filter(e => e.sets.some(s => s.done));

  const prs = [];
  const e1prs = [];
  entries.forEach(e => {
    const mx = Math.max(0, ...e.sets.filter(s => s.done).map(s => s.w || 0));
    if (mx > 0 && mx > bestWeightFor(S, e.id)) prs.push(e.id);
    const rec = is1RMRecord(S, e.id, e);
    if (rec && !prs.includes(e.id)) e1prs.push({ id: e.id, ...rec });
  });

  const w = {
    id: active.id, d: active.d, start: active.start, end: active.end || Date.now(),
    routineId: active.routineId || null, name: active.name || 'Freestyle', bw: active.bw || null,
    entries, prs
  };
  w.vol = workoutVolume(w);

  entries.forEach(e => {
    const mx = Math.max(0, ...e.sets.filter(s => s.done).map(s => s.w || 0), e.topW || 0);
    if (mx > 0) {
      const cur = S.exWeights[e.id];
      if (!cur || mx > cur.w) S.exWeights[e.id] = { w: mx, d: w.d };
    }
  });

  S.workouts.push(w);
  return { workout: w, prs, e1prs };
}
