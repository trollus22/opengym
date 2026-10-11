/* Resolves "today's workout, with concrete numbers" for the watch app.
 *
 * Mirrors beginWorkout() in frontend/sheets.jsx — same imports, same order of operations — so
 * the weight/reps the watch shows are computed by the exact code the web app already tests
 * (frontend/src/lib/progression.test.js, history.test.js), not a second copy of it. See
 * docs/WATCH_APP.md for why this crosses into frontend/src/lib instead of duplicating it.
 *
 * The exercise library (EXIDX, 1300+ records) never leaves the server: the watch only gets the
 * few fields it needs to render one exercise row.
 */
import { effectiveRoutineId, buildSets, modeOf } from '../../frontend/src/lib/history.js';
import { nextPrescription, applyPrescription } from '../../frontend/src/lib/progression.js';
import { EXIDX } from '../../frontend/src/lib/exercises.js';

/** `iso` is the caller's own local date (the watch's, not the server's) — same convention the
 *  web app uses (todayISO() runs on the user's device, never the server's clock). */
export function resolveToday(state, iso) {
  const S = withDefaults(state);
  const routineId = effectiveRoutineId(S, iso);
  if (!routineId) return { rest: true, unit: S.unit };
  const routine = (S.routines || []).find(r => r.id === routineId);
  if (!routine) return { rest: true, unit: S.unit };

  const entries = (routine.ex || []).map(cfg => {
    const plan = nextPrescription(S, cfg, routine);
    const sets = applyPrescription(buildSets(S, cfg), plan);
    const ex = EXIDX[cfg.id];
    return {
      id: cfg.id,
      name: ex ? ex.n : cfg.id,
      sg: cfg.sg || null,
      mode: modeOf(cfg),
      sets,
      why: plan.why || null,
      // Echoed back verbatim in POST /api/watch/log's `target` field — this is what the
      // progression engine judges the finished session against next time (readSession's
      // `fallback`). The watch never needs to understand it, only pass it through unchanged,
      // same as target: { ...cfg } in beginWorkout (frontend/sheets.jsx:782).
      target: { ...cfg }
    };
  });

  return {
    rest: false,
    unit: S.unit,
    routineId: routine.id,
    name: routine.name,
    emoji: routine.emoji || null,
    entries
  };
}

// The fields nextPrescription/buildSets/effectiveRoutineId read — same shape server.js already
// assumes elsewhere (readState never returns a partial object once a profile has synced once,
// but a brand-new profile can, and the watch is often the first thing to poll after sign-up).
function withDefaults(S) {
  return {
    unit: 'kg', routines: [], week: {}, dayPlan: {}, workouts: [], exWeights: {},
    ...(S || {})
  };
}
