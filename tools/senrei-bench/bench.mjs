#!/usr/bin/env node
// Isolated semantic kernel; not the production Enbu/Jinrei/Senritsu engine.
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import assert from 'node:assert/strict';

const methods = ['tick', 'active', 'event', 'analytic'];
function makeScenario(name, count) {
  return Array.from({ length: count }, (_, id) => {
    const live = name === 'dense' || name === 'bounded' || (id % 10 === 0);
    const longMove = name === 'dense';
    return {
      id, x: id % 5, speed: 1 + (id % 3), stop: longMove ? 100_000_000 : 80 + ((id * 37) % 400),
      hp: live ? 30 + (id % 9) * 7 : 0,
      damage: 3 + (id % 5), interval: 2 + (id % 11), next: 1,
      hits: 0, tickSum: 0, events: [],
    };
  });
}
function copy(actors) { return actors.map(a => ({ ...a, events: [] })); }
function step(a, tick, capture) {
  if (a.hp <= 0) return;
  if (a.x < a.stop) { a.x = Math.min(a.stop, a.x + a.speed); return; }
  if (tick < a.next) return;
  a.hp = Math.max(0, a.hp - a.damage);
  a.hits++;
  a.tickSum += tick;
  a.next = tick + a.interval;
  if (capture) a.events.push(tick);
}
function runTick(actors, ticks, capture = false) {
  for (let tick = 1; tick <= ticks; tick++) {
    for (let i = 0; i < actors.length; i++) step(actors[i], tick, capture);
  }
  return actors;
}
function runActive(actors, ticks, capture = false) {
  const active = [];
  for (let i = 0; i < actors.length; i++) if (actors[i].hp > 0) active.push(i);
  for (let tick = 1; tick <= ticks && active.length; tick++) {
    let remaining = 0;
    for (let i = 0; i < active.length; i++) {
      const id = active[i];
      step(actors[id], tick, capture);
      if (actors[id].hp > 0) active[remaining++] = id;
    }
    active.length = remaining;
  }
  return actors;
}

// Schedules arrivals and hits. Independent-actor assumption is deliberate.
function runEvent(actors, ticks, capture = false) {
  const heap = [];
  const less = (a, b) => a.t < b.t || (a.t === b.t && a.id < b.id);
  function push(event) {
    if (event.t > ticks) return;
    let i = heap.length;
    heap.push(event);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!less(event, heap[parent])) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = event;
  }
  function pop() {
    const head = heap[0];
    const tail = heap.pop();
    if (heap.length) {
      let i = 0;
      while (true) {
        const left = i * 2 + 1;
        if (left >= heap.length) break;
        const right = left + 1;
        const child = right < heap.length && less(heap[right], heap[left]) ? right : left;
        if (!less(heap[child], tail)) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = tail;
    }
    return head;
  }
  for (const a of actors) {
    if (a.hp <= 0) continue;
    if (a.x < a.stop) push({ t: Math.ceil((a.stop - a.x) / a.speed), id: a.id, arrival: true });
    else push({ t: Math.max(1, a.next), id: a.id, arrival: false });
  }
  while (heap.length) {
    const {t, id, arrival} = pop();
    const a = actors[id];
    if (arrival) {
      a.x = a.stop;
      push({ t: Math.max(t + 1, a.next), id, arrival: false });
    } else {
      a.hp = Math.max(0, a.hp - a.damage);
      a.hits++;
      a.tickSum += t;
      a.next = t + a.interval;
      if (capture) a.events.push(t);
      if (a.hp > 0) push({ t: a.next, id, arrival: false });
    }
  }
  for (const a of actors) {
    if (a.hp > 0 && a.x < a.stop) a.x = Math.min(a.stop, a.x + ticks * a.speed);
  }
  return actors;
}

function runAnalytic(actors, ticks, capture = false) {
  for (const a of actors) {
    if (a.hp <= 0) continue;
    let first = 1;
    if (a.x < a.stop) {
      const moveTicks = Math.ceil((a.stop - a.x) / a.speed);
      const movedTicks = Math.min(ticks, moveTicks);
      a.x = Math.min(a.stop, a.x + movedTicks * a.speed);
      first = moveTicks + 1; // the arrival tick is movement, not attack
    }
    first = Math.max(first, a.next);
    if (first > ticks) continue;
    const due = 1 + Math.floor((ticks - first) / a.interval);
    const lethal = Math.ceil(a.hp / a.damage);
    const hits = Math.min(due, lethal);
    a.hp = Math.max(0, a.hp - hits * a.damage);
    a.hits += hits;
    a.tickSum += hits * first + (a.interval * hits * (hits - 1)) / 2;
    a.next = first + hits * a.interval;
    if (capture) for (let h = 0; h < hits; h++) a.events.push(first + h * a.interval);
  }
  return actors;
}
const runners = { tick: runTick, active: runActive, event: runEvent, analytic: runAnalytic };
function snapshot(actors, capture) {
  return actors.map(a => capture
    ? [a.x, a.hp, a.next, a.hits, a.tickSum, a.events]
    : [a.x, a.hp, a.next, a.hits, a.tickSum]);
}
function verify() {
  let cases = 0;
  for (const scenario of ['sparse', 'dense', 'bounded']) {
    for (const count of [1, 2, 7, 31, 78]) {
      for (const ticks of [0, 1, 2, 7, 16, 49, 100, 400, 1_200]) {
        const source = makeScenario(scenario, count);
        const expected = snapshot(runTick(copy(source), ticks, true), true);
        for (const method of ['active', 'event', 'analytic']) {
          assert.deepEqual(snapshot(runners[method](copy(source), ticks, true), true), expected,
            `${method}, scenario=${scenario}, count=${count}, ticks=${ticks}`);
        }
        cases++;
      }
    }
  }
  return cases;
}
function median(values) { const a = [...values].sort((a, b) => a - b); return a[Math.floor(a.length / 2)]; }
function percentile(values, p) { const a = [...values].sort((a, b) => a - b); return a[Math.ceil(p * a.length) - 1]; }
function measure(name, method, count, ticks, warmups, samples) {
  const source = makeScenario(name, count);
  const observations = [];
  // Calibrate microtasks: amortize timer resolution/GC perturbation across a batch.
  const pilotActors = copy(source);
  const pilotStart = performance.now();
  runners[method](pilotActors, ticks);
  const pilotMs = Math.max(.001, performance.now() - pilotStart);
  const batchSize = Math.max(1, Math.min(128, Math.ceil(15 / pilotMs)));
  let output;
  for (let i = 0; i < warmups + samples; i++) {
    // Setup allocations do not enter the execution-only timer.
    const batch = Array.from({length: batchSize}, () => copy(source));
    const start = performance.now();
    for (const actors of batch) runners[method](actors, ticks);
    const elapsed = (performance.now() - start) / batchSize;
    if (i >= warmups) observations.push(elapsed);
    output = snapshot(batch[0], false);
  }
  return { batch_size: batchSize, median_ms: median(observations), p95_ms: percentile(observations, .95), min_ms: Math.min(...observations), max_ms: Math.max(...observations), state: output };
}
function flags(args) {
  const opt = { count: 1024, ticks: 10000, warmups: 3, samples: 9, json: false, test: false };
  for (const arg of args) {
    if (arg === '--test') opt.test = true;
    else if (arg === '--json') opt.json = true;
    else {
      const m = /^--(count|ticks|warmups|samples)=(\d+)$/.exec(arg);
      if (!m) throw Error(`Unknown argument: ${arg}`);
      opt[m[1]] = Number(m[2]);
    }
  }
  if (opt.count < 1 || opt.ticks < 0 || opt.samples < 1 || opt.warmups < 0) throw Error('Invalid options');
  return opt;
}
const options = flags(process.argv.slice(2));
const verified_cases = verify();
if (options.test) {
  console.log(`PASS ${verified_cases} deterministic differential cases; methods: ${methods.join(', ')}`);
} else {
  const results = [];
  for (const scenario of ['sparse', 'bounded', 'dense']) {
    const measured = {};
    for (const method of methods) measured[method] = measure(scenario, method, options.count, options.ticks, options.warmups, options.samples);
    for (const method of ['active', 'event', 'analytic']) assert.deepEqual(measured[method].state, measured.tick.state,
      `Benchmark workload mismatch: ${scenario}/${method}`);
    results.push({ scenario, methods: Object.fromEntries(methods.map(method => {
      const {state, ...metrics} = measured[method];
      return [method, { ...metrics, speedup_vs_tick: measured.tick.median_ms / metrics.median_ms }];
    })) });
  }
  const result = { kind: 'synthetic-isolated-semantic-kernel', semantics: 'independent actors; move to fixed stop then periodic attacks on private targets; integer tick; result-only; no Jinrei/CU/visibility', verified_cases,
    environment: {node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, cpu_count: os.cpus().length},
    options, timestamp_utc: new Date().toISOString(), results};
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else for (const row of results) for (const [name, v] of Object.entries(row.methods)) console.log(`${row.scenario.padEnd(8)} ${name.padEnd(9)} median=${v.median_ms.toFixed(3)}ms p95=${v.p95_ms.toFixed(3)}ms speedup=${v.speedup_vs_tick.toFixed(2)}x`);
}
