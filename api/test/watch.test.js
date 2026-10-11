import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleState } from './helpers.mjs';
import { resolveToday } from '../watch/plan.js';
import { finalizeWorkout } from '../watch/finish.js';

// sampleState's routine 'r1' sits on week[1] (Monday) — 2026-07-27 is a Monday.
const MONDAY = '2026-07-27';
// sampleState's week has no Tuesday/Saturday entry and no dayPlan override.
const REST_DAY = '2026-07-28';

test('resolveToday reports a rest day when nothing is scheduled', () => {
  const out = resolveToday(sampleState(), REST_DAY);
  assert.equal(out.rest, true);
});

test('resolveToday resolves the scheduled routine with a live prescription', () => {
  const out = resolveToday(sampleState(), MONDAY);
  assert.equal(out.rest, false);
  assert.equal(out.routineId, 'r1');
  assert.equal(out.name, 'Full body A');
  assert.equal(out.entries.length, 2);

  // exercise 0001: linear progression, one prior session that missed its last set (8 of 10
  // reps) — same weight held again, same rule the web app's progression.test.js pins down.
  const lift = out.entries.find(e => e.id === '0001');
  assert.equal(lift.mode, 'reps');
  assert.equal(lift.sets.length, 3);
  assert.equal(lift.sets[0].w, 20);
  assert.ok(lift.why[0].includes('Missed reps'));

  // exercise 0007: no reps-only policy applies to a timed set, so it stays 'off' and just
  // reflects the routine's own plan.
  const timed = out.entries.find(e => e.id === '0007');
  assert.equal(timed.mode, 'time');
  assert.equal(timed.sets.length, 3);
  assert.equal(timed.sets[0].sec, 45);
});

test('resolveToday never leaks the exercise library beyond name/mode', () => {
  const out = resolveToday(sampleState(), MONDAY);
  const lift = out.entries.find(e => e.id === '0001');
  assert.equal(typeof lift.name, 'string');
  assert.equal(Object.hasOwn(lift, 'bp'), false);
  assert.equal(Object.hasOwn(lift, 'st'), false); // instruction steps — no reason to ship these
});

test('finalizeWorkout appends a workout, detects PRs, and updates exWeights — same shape doFinishWorkout builds', () => {
  const S = sampleState();
  const active = {
    id: 'w2', d: MONDAY, start: 2000, end: 2000 + 40 * 60000, routineId: 'r1', name: 'Full body A', bw: 79,
    entries: [
      // beats the prior best of 20 kg — a PR — and clears every rep (linear should climb next time)
      { id: '0001', target: { sets: 3, reps: 10, weight: 20 }, sets: [{ w: 22.5, r: 10, done: true }, { w: 22.5, r: 10, done: true }, { w: 22.5, r: 10, done: true }] },
      // untouched exercise — dropped, same as doFinishWorkout's .filter(e => e.sets.some(s => s.done))
      { id: '0007', target: { sets: 3, sec: 45 }, sets: [{ sec: 45, w: 0, done: false }] }
    ]
  };
  const { workout, prs } = finalizeWorkout(S, active);

  assert.equal(S.workouts.length, 2);
  assert.equal(S.workouts[1], workout);
  assert.deepEqual(prs, ['0001']);
  assert.equal(workout.entries.length, 1, 'the untouched exercise is dropped');
  assert.equal(workout.vol, 22.5 * 10 * 3);
  assert.equal(S.exWeights['0001'].w, 22.5);
});

test('finalizeWorkout drops an exercise with no checked-off set — same as doFinishWorkout', () => {
  const S = sampleState();
  const active = {
    id: 'w2', d: MONDAY, start: 0, end: 60000, routineId: 'r1', name: 'Full body A',
    entries: [{ id: '0001', target: { sets: 1, reps: 10, weight: 20 }, sets: [{ w: 20, r: 10, done: false }] }]
  };
  const { workout } = finalizeWorkout(S, active);
  assert.equal(workout.entries.length, 0);
  assert.equal(workout.vol, 0);
});
