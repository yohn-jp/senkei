#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const fixturePath = resolve(repositoryRoot, "scenarios/campaign/source-fixtures.json");
const conformanceDirectory = resolve(repositoryRoot, "scenarios/campaign/conformance");
const apiVersion = { major: 1, minor: 0, patch: 0 };
const equivalentStarterText = `senkei first_march {
    action advance_one {
        when true,
        do move_forward(argmin unit in allies.units by unit.position then unit.slot_id),
    },
}`;
const argumentsSet = new Set(process.argv.slice(2));
const writeSources = argumentsSet.has("--write-source-fixtures");
const writeRequests = argumentsSet.has("--write-requests");
const writeAll = argumentsSet.has("--write-all");
const updateSources = writeSources || writeAll;
const updateRequests = writeRequests || writeAll;
const requireFromProject = createRequire(resolve(repositoryRoot, "package.json"));
const typescript = requireFromProject("typescript");

function fail(message) {
  console.error(`scenario input generation: ${message}`);
  process.exit(1);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function sameJson(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function envelope(requestId, operation, payload) {
  return {
    api_version: apiVersion,
    request_id: requestId,
    operation,
    payload,
  };
}

async function runNative(requests) {
  const executable = process.env.SENKEI_NATIVE_DISPATCHER;
  const command = executable ?? "cargo";
  const args = executable
    ? []
    : ["run", "--quiet", "--locked", "-p", "senkei-wasm", "--bin", "senkei-wasm-dispatch"];
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: repositoryRoot, stdio: ["pipe", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`native dispatcher exited with status ${code}`));
        return;
      }
      try {
        const responses = stdout.trimEnd().split("\n").map((line) => JSON.parse(line));
        if (responses.length !== requests.length) {
          reject(new Error(`native dispatcher returned ${responses.length} responses for ${requests.length} requests`));
          return;
        }
        resolvePromise(responses);
      } catch (error) {
        reject(error);
      }
    });
    for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
    child.stdin.end();
  });
}

function assertOk(response, label) {
  if (!response?.ok) throw new Error(`${label} failed: ${JSON.stringify(response?.error)}`);
  return response.result;
}

async function loadCatalogModule() {
  const tempRoot = await mkdtemp(resolve(tmpdir(), "senkei-scenario-catalog-"));
  const sources = [
    "scenarios/campaign/catalog.ts",
    "apps/web/src/contracts/core.ts",
  ];
  for (const sourcePath of sources) {
    const absoluteSource = resolve(repositoryRoot, sourcePath);
    const outputPath = resolve(tempRoot, sourcePath.replace(/\.ts$/, ".js"));
    const source = await readFile(absoluteSource, "utf8");
    const output = typescript.transpileModule(source, {
      compilerOptions: {
        target: typescript.ScriptTarget.ES2022,
        module: typescript.ModuleKind.CommonJS,
      },
      fileName: absoluteSource,
    }).outputText;
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output);
  }
  const catalog = requireFromProject(resolve(tempRoot, "scenarios/campaign/catalog.js"));
  return { tempRoot, ...catalog };
}

function makeSnapshot(draft, compileResult) {
  return {
    schema_version: draft.schema_version,
    id: draft.id,
    revision: draft.revision,
    ruleset: draft.ruleset,
    configuration: draft.configuration,
    program: compileResult.program,
    initial_memory: draft.initial_memory,
  };
}

function domainInteger(value) {
  return value?.kind === "integer" ? value.value : undefined;
}

function domainEntity(value) {
  return value?.kind === "entity" ? value.value : undefined;
}

function countNodes(value) {
  if (Array.isArray(value)) return 1 + value.reduce((total, item) => total + countNodes(item), 0);
  if (value !== null && typeof value === "object") {
    return 1 + Object.values(value).reduce((total, item) => total + countNodes(item), 0);
  }
  return 1;
}

function checkDamageHpParity(response, scenarioId) {
  const frames = response.replay?.frames ?? [];
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];
    const damageByTarget = new Map();
    const healingTargets = new Set();
    for (const event of current.events) {
      if (event.event === "unit_healed") {
        const target = domainEntity(event.payload.target);
        if (target) healingTargets.add(target);
      }
      if (!["unit_attacked", "tower_attacked", "core_attacked"].includes(event.event)) continue;
      const target = domainEntity(event.payload.target);
      const damage = domainInteger(event.payload.damage);
      if (target && damage !== undefined) damageByTarget.set(target, (damageByTarget.get(target) ?? 0) + damage);
    }
    for (const [target, damage] of damageByTarget) {
      if (healingTargets.has(target)) continue;
      const before = domainInteger(previous.visible_state?.entities?.[target]?.fields?.hp);
      const after = domainInteger(current.visible_state?.entities?.[target]?.fields?.hp);
      if (before === undefined || after === undefined) {
        throw new Error(`${scenarioId} tick ${current.tick} damage target ${target} is missing visible HP`);
      }
      const expected = Math.max(0, before - damage);
      if (after !== expected) {
        throw new Error(`${scenarioId} tick ${current.tick} target ${target} event damage=${damage}, HP ${before}->${after}; expected ${expected}`);
      }
    }
  }
}

function acceptedUnitActorHistory(response, side) {
  const framesByTick = new Map(response.replay.frames.map((frame) => [frame.tick, frame]));
  return (response.diagnostics?.events ?? [])
    .filter((event) => event.side === side && event.record.kind === "intent_accepted")
    .map((event) => {
      const intent = event.record.value.intent;
      const previousEntities = framesByTick.get(event.tick - 1)?.visible_state?.entities ?? {};
      const currentEntities = framesByTick.get(event.tick)?.visible_state?.entities ?? {};
      const actor = previousEntities[intent.actor] ?? currentEntities[intent.actor];
      if (actor?.entity_type !== "unit") return null;
      return {
        tick: event.tick,
        capability: intent.capability,
        unit_class: actor.fields.unit_class?.value,
        lane: actor.fields.lane?.value,
        position: domainInteger(actor.fields.position),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.tick - right.tick || left.capability.localeCompare(right.capability));
}

function oppositeOutcome(outcome) {
  return {
    attacker_victory: "defender_victory",
    defender_victory: "attacker_victory",
    draw: "draw",
    aborted: "aborted",
  }[outcome];
}

const packageResponse = (await runNative([
  envelope("scenario-package", "initial_ruleset", {}),
]))[0];
const ruleset = assertOk(packageResponse, "initial_ruleset");
if (ruleset.ruleset?.id !== "senkei.initial") fail("native package is not senkei.initial");

const catalogModule = await loadCatalogModule();
const scenarios = catalogModule.createCampaignScenarios(ruleset);
const beginnerPreset = catalogModule.createBeginnerPreset(ruleset);
const sourceFixtures = scenarios.map(({ id, npc }) => ({
  id,
  source: npc.program_input.source,
}));

try {
  let storedFixtures;
  try {
    storedFixtures = JSON.parse(await readFile(fixturePath, "utf8"));
  } catch {
    storedFixtures = null;
  }
  if (updateSources) {
    await writeFile(fixturePath, `${JSON.stringify(sourceFixtures, null, 2)}\n`);
  } else if (!sameJson(storedFixtures, sourceFixtures)) {
    fail("source-fixtures.json differs from the evaluated campaign catalog; use --write-source-fixtures after reviewing the change");
  }

  const textPreset = {
    ...beginnerPreset,
    program_input: { kind: "text", source: equivalentStarterText },
  };
  const compileInputs = [
    {
      key: "beginner-preset",
      draft: beginnerPreset,
      request: envelope("compile-beginner-preset", "compile_ast", {
        ruleset_ref: ruleset.ruleset,
        ast: beginnerPreset.program_input.ast,
      }),
    },
    ...scenarios.map((scenario) => ({
      key: scenario.id,
      draft: scenario.npc,
      request: envelope(`compile-${scenario.id}`, "compile_text", {
        ruleset_ref: ruleset.ruleset,
        source: scenario.npc.program_input.source,
      }),
    })),
    {
      key: "beginner-text-equivalent",
      draft: textPreset,
      request: envelope("compile-beginner-text-equivalent", "compile_text", {
        ruleset_ref: ruleset.ruleset,
        source: equivalentStarterText,
      }),
    },
  ];
  const compileResponses = await runNative(compileInputs.map((entry) => entry.request));
  const snapshots = new Map();
  const compileResults = new Map();
  compileInputs.forEach((entry, index) => {
    const compileResult = assertOk(compileResponses[index], `compile ${entry.key}`);
    compileResults.set(entry.key, compileResult);
    snapshots.set(entry.key, makeSnapshot(entry.draft, compileResult));
  });

  const privateObservationPaths = ["enemy.resources", "enemy.strategy", "enemy.program"];
  const privateObservationRequests = [
    envelope("compile-private-observation-control", "compile_text", {
      ruleset_ref: ruleset.ruleset,
      source: `senkei private_observation_control {
    action preserve {
        when self.resources >= 0,
        do move_forward(argmin unit in allies.units by unit.position then unit.slot_id),
    },
}`,
    }),
    ...privateObservationPaths.map((path, index) => envelope(
      `compile-private-observation-${index}`,
      "compile_text",
      {
        ruleset_ref: ruleset.ruleset,
        source: `senkei reject_private_${index} {
    action preserve {
        when ${path} >= 0,
        do move_forward(argmin unit in allies.units by unit.position then unit.slot_id),
    },
}`,
      },
    )),
  ];
  const privateObservationResponses = await runNative(privateObservationRequests);
  assertOk(privateObservationResponses[0], "compile legal self.resources observation control");
  privateObservationPaths.forEach((path, index) => {
    const response = privateObservationResponses[index + 1];
    const error = response?.error;
    if (response?.ok || error?.code !== "validation_failed" ||
        !error.message?.includes(path) ||
        !/(unknown observation|not accessible to Jinrei)/.test(error.message)) {
      throw new Error(`private observation ${path} was not rejected by the native compiler: ${JSON.stringify(response)}`);
    }
  });
  console.log(`PRIVATE_OBSERVATIONS legal=self.resources; rejected=${privateObservationPaths.join(",")}`);

  for (const key of ["ast", "text"]) {
    const inputKey = key === "ast" ? "beginner-preset" : "beginner-text-equivalent";
    const compileResult = compileResults.get(inputKey);
    if (!sameJson(compileResult.ast, compileResults.get("beginner-preset").ast) ||
        !sameJson(compileResult.program, compileResults.get("beginner-preset").program) ||
        !sameJson(compileResult.estimated_cu, compileResults.get("beginner-preset").estimated_cu)) {
      throw new Error(`structured and text starter compilation differ (${key})`);
    }
  }

  const contextIds = [...scenarios.map((scenario) => `campaign-${scenario.id}`), "starter-equivalence", "tactic-effect", "symmetry", "symmetry-three-unit"];
  const contextRequests = contextIds.map((matchId) => envelope(
    `context-${matchId}`,
    "new_match_context",
    { ruleset_ref: ruleset.ruleset, match_id: matchId },
  ));
  const contextResponses = await runNative(contextRequests);
  const contexts = new Map(contextResponses.map((response, index) => [
    contextIds[index], assertOk(response, `context ${contextIds[index]}`),
  ]));
  const caseInputs = scenarios.map((scenario) => ({
    id: scenario.id,
    request: envelope(
      `campaign-${scenario.id}`,
      "simulate",
      {
        attacker: snapshots.get("beginner-preset"),
        defender: snapshots.get(scenario.id),
        context: contexts.get(`campaign-${scenario.id}`),
        include_diagnostics: true,
      },
    ),
  }));

  const symmetricConfiguration = {
    ...snapshots.get("beginner-preset").configuration,
    initial_deployments: {
      kind: "list",
      value: snapshots.get("beginner-preset").configuration.initial_deployments.value.slice(0, 1),
    },
  };
  const commonTacticRoster = {
    ...snapshots.get("beginner-preset"),
    configuration: symmetricConfiguration,
  };
  const firstTacticSameRoster = {
    ...commonTacticRoster,
    id: "probe-first-march",
    program: snapshots.get("first-march").program,
  };
  const pressureTacticSameRoster = {
    ...commonTacticRoster,
    id: "probe-core-pressure",
    program: snapshots.get("core-pressure").program,
  };
  const firstTacticThreeUnit = {
    ...snapshots.get("beginner-preset"),
    id: "probe-three-unit-first-march",
    program: snapshots.get("first-march").program,
  };
  const pressureTacticThreeUnit = {
    ...snapshots.get("beginner-preset"),
    id: "probe-three-unit-core-pressure",
    program: snapshots.get("core-pressure").program,
  };
  caseInputs.push(
    {
      id: "starter-equivalence-ast",
      request: envelope("starter-equivalence-ast", "simulate", {
        attacker: snapshots.get("beginner-preset"),
        defender: snapshots.get("first-march"),
        context: contexts.get("starter-equivalence"),
        include_diagnostics: true,
      }),
    },
    {
      id: "starter-equivalence-text",
      request: envelope("starter-equivalence-text", "simulate", {
        attacker: snapshots.get("beginner-text-equivalent"),
        defender: snapshots.get("first-march"),
        context: contexts.get("starter-equivalence"),
        include_diagnostics: true,
      }),
    },
    {
      id: "tactic-effect-first-march",
      request: envelope("tactic-effect-first-march", "simulate", {
        attacker: firstTacticSameRoster,
        defender: snapshots.get("first-march"),
        context: contexts.get("tactic-effect"),
        include_diagnostics: true,
      }),
    },
    {
      id: "tactic-effect-core-pressure",
      request: envelope("tactic-effect-core-pressure", "simulate", {
        attacker: pressureTacticSameRoster,
        defender: snapshots.get("first-march"),
        context: contexts.get("tactic-effect"),
        include_diagnostics: true,
      }),
    },
    {
      id: "symmetry-first-march-attacks-first",
      request: envelope("symmetry-first-march-attacks-first", "simulate", {
        attacker: firstTacticSameRoster,
        defender: pressureTacticSameRoster,
        context: contexts.get("symmetry"),
        include_diagnostics: true,
      }),
    },
    {
      id: "symmetry-core-pressure-attacks-first",
      request: envelope("symmetry-core-pressure-attacks-first", "simulate", {
        attacker: pressureTacticSameRoster,
        defender: firstTacticSameRoster,
        context: contexts.get("symmetry"),
        include_diagnostics: true,
      }),
    },
    {
      id: "symmetry-identical-first-march",
      request: envelope("symmetry-identical-first-march", "simulate", {
        attacker: firstTacticSameRoster,
        defender: firstTacticSameRoster,
        context: contexts.get("symmetry"),
        include_diagnostics: true,
      }),
    },
    {
      id: "symmetry-identical-core-pressure",
      request: envelope("symmetry-identical-core-pressure", "simulate", {
        attacker: pressureTacticSameRoster,
        defender: pressureTacticSameRoster,
        context: contexts.get("symmetry"),
        include_diagnostics: true,
      }),
    },
    {
      id: "symmetry-three-unit-first-march-attacks-first",
      request: envelope("symmetry-three-unit-first-march-attacks-first", "simulate", {
        attacker: firstTacticThreeUnit,
        defender: pressureTacticThreeUnit,
        context: contexts.get("symmetry-three-unit"),
        include_diagnostics: true,
      }),
    },
    {
      id: "symmetry-three-unit-core-pressure-attacks-first",
      request: envelope("symmetry-three-unit-core-pressure-attacks-first", "simulate", {
        attacker: pressureTacticThreeUnit,
        defender: firstTacticThreeUnit,
        context: contexts.get("symmetry-three-unit"),
        include_diagnostics: true,
      }),
    },
    {
      id: "symmetry-three-unit-identical-first-march",
      request: envelope("symmetry-three-unit-identical-first-march", "simulate", {
        attacker: firstTacticThreeUnit,
        defender: firstTacticThreeUnit,
        context: contexts.get("symmetry-three-unit"),
        include_diagnostics: true,
      }),
    },
    {
      id: "symmetry-three-unit-identical-core-pressure",
      request: envelope("symmetry-three-unit-identical-core-pressure", "simulate", {
        attacker: pressureTacticThreeUnit,
        defender: pressureTacticThreeUnit,
        context: contexts.get("symmetry-three-unit"),
        include_diagnostics: true,
      }),
    },
  );
  const goldenCaseIds = new Set(scenarios.map((scenario) => scenario.id));

  for (const entry of caseInputs) entry.request.payload.diagnostics_side = "attacker";
  const simulationResponses = await runNative(caseInputs.map((entry) => entry.request));
  const responseById = new Map(caseInputs.map((entry, index) => [entry.id, assertOk(simulationResponses[index], `simulate ${entry.id}`)]));
  // Regression and symmetry evidence need both perspectives. Request each owner explicitly;
  // never rely on one owner channel exposing the opposing side's diagnostics.
  const diagnosticCases = caseInputs;
  const defenderResponses = await runNative(diagnosticCases.map((entry) => ({
    ...entry.request, request_id: `${entry.request.request_id}-defender-diagnostics`,
    payload: { ...entry.request.payload, diagnostics_side: "defender" },
  })));
  const completeDiagnosticsById = new Map(diagnosticCases.map((entry, index) => {
    const attacker = responseById.get(entry.id);
    const defender = assertOk(defenderResponses[index], `defender diagnostics ${entry.id}`);
    if (attacker.authorized_side !== "attacker" || defender.authorized_side !== "defender" ||
        !sameJson(attacker.result, defender.result) || !sameJson(attacker.replay, defender.replay) ||
        attacker.diagnostics.events.some((event) => event.side !== "attacker") ||
        defender.diagnostics.events.some((event) => event.side !== "defender")) {
      throw new Error(`side-specific diagnostics changed the match or leaked a channel for ${entry.id}`);
    }
    return [entry.id, {
      events: [...attacker.diagnostics.events, ...defender.diagnostics.events],
      cu_by_side: { ...attacker.diagnostics.cu_by_side, ...defender.diagnostics.cu_by_side },
      final_memory_by_side: { ...attacker.diagnostics.final_memory_by_side, ...defender.diagnostics.final_memory_by_side },
    }];
  }));
  if (!sameJson(responseById.get("starter-equivalence-ast"), responseById.get("starter-equivalence-text"))) {
    throw new Error("equivalent structured and text tactics produced different simulation responses");
  }
  if (responseById.get("tactic-effect-first-march").result.final_state_digest ===
      responseById.get("tactic-effect-core-pressure").result.final_state_digest) {
    throw new Error("same formation with different compiled tactics did not change the simulated state");
  }
  const orientationOutcome = responseById.get("symmetry-first-march-attacks-first").result.outcome;
  const mirroredOutcome = responseById.get("symmetry-core-pressure-attacks-first").result.outcome;
  const symmetryIds = [
    "symmetry-first-march-attacks-first",
    "symmetry-core-pressure-attacks-first",
    "symmetry-identical-first-march",
    "symmetry-identical-core-pressure",
    "symmetry-three-unit-first-march-attacks-first",
    "symmetry-three-unit-core-pressure-attacks-first",
    "symmetry-three-unit-identical-first-march",
    "symmetry-three-unit-identical-core-pressure",
  ];
  for (const id of symmetryIds) {
    const result = { ...responseById.get(id), diagnostics: completeDiagnosticsById.get(id) };
    const events = result.replay.frames.flatMap((frame) => frame.events);
    const counts = Object.fromEntries([...new Set(events.map((event) => event.event))].map((event) => [event, events.filter((item) => item.event === event).length]));
    const finalEntities = result.replay.frames.at(-1)?.visible_state?.entities ?? {};
    const cores = Object.values(finalEntities).filter((entity) => entity.entity_type === "core").map((entity) => [entity.owner, entity.fields.hp?.value]);
    const initialEntities = result.replay.frames[0]?.visible_state?.entities ?? {};
    const accepted = (result.diagnostics?.events ?? []).filter((event) => event.record.kind === "intent_accepted").reduce((total, event) => {
      const key = `${event.side}:${event.record.value.intent.capability}`;
      total[key] = (total[key] ?? 0) + 1;
      return total;
    }, {});
    const acceptedActors = (result.diagnostics?.events ?? []).filter((event) => event.record.kind === "intent_accepted").reduce((total, event) => {
      const intent = event.record.value.intent;
      const actor = intent.actor ? initialEntities[intent.actor] : undefined;
      const unitClass = actor?.fields.unit_class?.value ?? "?";
      const key = `${event.side}:${intent.capability}:${unitClass}`;
      total[key] = (total[key] ?? 0) + 1;
      return total;
    }, {});
    const coreDamageByOwner = {};
    for (const frame of result.replay.frames) {
      for (const event of frame.events.filter((item) => item.event === "core_attacked")) {
        const target = event.payload.target?.value;
        const owner = frame.visible_state?.entities?.[target]?.owner ?? "unknown";
        coreDamageByOwner[owner] = (coreDamageByOwner[owner] ?? 0) + (event.payload.damage?.value ?? 0);
      }
    }
    console.log(`SYMMETRY ${id}: ${result.result.outcome} tick=${result.result.final_tick} events=${JSON.stringify(counts)} cores=${JSON.stringify(cores)} accepted=${JSON.stringify(accepted)} actors=${JSON.stringify(acceptedActors)} core_damage=${JSON.stringify(coreDamageByOwner)}`);
    if (process.env.SENKEI_TRACE_ACTORS === "1" && id.includes("three-unit")) {
      const framesByTick = new Map(result.replay.frames.map((frame) => [frame.tick, frame]));
      const actorTicks = (result.diagnostics?.events ?? [])
        .filter((event) => event.record.kind === "intent_accepted")
        .map((event) => {
          const intent = event.record.value.intent;
          const previousState = framesByTick.get(event.tick - 1)?.visible_state?.entities ?? {};
          const currentState = framesByTick.get(event.tick)?.visible_state?.entities ?? {};
          const actor = previousState[intent.actor] ?? currentState[intent.actor];
          return {
            tick: event.tick,
            side: event.side,
            capability: intent.capability,
            actor_id: intent.actor,
            unit_class: actor?.fields.unit_class?.value ?? "?",
            position_before_tick: domainInteger(actor?.fields.position),
          };
        });
      const actorCounts = new Map();
      for (const actor of actorTicks) {
        const keyWithoutPosition = `${actor.side}:${actor.capability}:${actor.unit_class}`;
        const summary = actorCounts.get(keyWithoutPosition) ?? { positions: [], actor_ids: [] };
        summary.positions.push({ tick: actor.tick, position: actor.position_before_tick });
        if (!summary.actor_ids.includes(actor.actor_id)) summary.actor_ids.push(actor.actor_id);
        actorCounts.set(keyWithoutPosition, summary);
      }
      const compactRanges = (positions) => {
        const ranges = [];
        for (const point of positions) {
          const last = ranges.at(-1);
          const tickStep = last ? point.tick - last.last_tick : undefined;
          const positionStep = last ? point.position - last.last_position : undefined;
          if (last && tickStep > 0 && (last.tick_step === undefined || tickStep === last.tick_step) &&
              (last.position_step === undefined || positionStep === last.position_step)) {
            last.tick_step = tickStep;
            last.position_step = positionStep;
            last.last_tick = point.tick;
            last.last_position = point.position;
          } else {
            ranges.push({
              ticks: [point.tick, point.tick],
              positions: [point.position, point.position],
              last_tick: point.tick,
              last_position: point.position,
              position_step: undefined,
              tick_step: undefined,
            });
          }
          const current = ranges.at(-1);
          current.ticks[1] = current.last_tick;
          current.positions[1] = current.last_position;
        }
        return ranges.map(({ ticks, positions: positionRange }) => ({ ticks, positions: positionRange }));
      };
      console.log(`SYMMETRY_ACTOR_TICKS ${id}: ${JSON.stringify([...actorCounts].map(([key, summary]) => ({ key, actor_ids: summary.actor_ids, count: summary.positions.length, tick_positions: compactRanges(summary.positions) })))}`);
    }
  }
  const expectedMirroredOutcome = oppositeOutcome(orientationOutcome);
  if (mirroredOutcome !== expectedMirroredOutcome) {
    throw new Error(`mirrored symmetric tactical battle changed ${orientationOutcome} to ${mirroredOutcome}, expected ${expectedMirroredOutcome}`);
  }
  const threeUnitFirstMarch = responseById.get("symmetry-three-unit-first-march-attacks-first");
  const threeUnitCorePressure = responseById.get("symmetry-three-unit-core-pressure-attacks-first");
  const expectedThreeUnitMirror = oppositeOutcome(threeUnitFirstMarch.result.outcome);
  if (threeUnitCorePressure.result.outcome !== expectedThreeUnitMirror) {
    throw new Error(`mirrored three-unit battle changed ${threeUnitFirstMarch.result.outcome} to ${threeUnitCorePressure.result.outcome}, expected ${expectedThreeUnitMirror}`);
  }
  for (const [attackFirst, attackSecond] of [
    ["symmetry-three-unit-first-march-attacks-first", "symmetry-three-unit-core-pressure-attacks-first"],
    ["symmetry-three-unit-core-pressure-attacks-first", "symmetry-three-unit-first-march-attacks-first"],
  ]) {
    const first = { ...responseById.get(attackFirst), diagnostics: completeDiagnosticsById.get(attackFirst) };
    const second = { ...responseById.get(attackSecond), diagnostics: completeDiagnosticsById.get(attackSecond) };
    if (!sameJson(acceptedUnitActorHistory(first, "attacker"), acceptedUnitActorHistory(second, "defender")) ||
        !sameJson(acceptedUnitActorHistory(first, "defender"), acceptedUnitActorHistory(second, "attacker"))) {
      throw new Error(`mirrored three-unit actor selection differs between ${attackFirst} and ${attackSecond}`);
    }
  }
  for (const id of ["symmetry-three-unit-identical-first-march", "symmetry-three-unit-identical-core-pressure"]) {
    const response = { ...responseById.get(id), diagnostics: completeDiagnosticsById.get(id) };
    const finalEntities = response.replay.frames.at(-1)?.visible_state?.entities ?? {};
    const coreHp = Object.values(finalEntities)
      .filter((entity) => entity.entity_type === "core")
      .map((entity) => domainInteger(entity.fields.hp))
      .sort((left, right) => left - right);
    if (response.result.outcome !== "draw" || !sameJson(coreHp, [0, 0])) {
      throw new Error(`${id} asymmetric equal-roster result: outcome=${response.result.outcome}, core_hp=${JSON.stringify(coreHp)}`);
    }
    if (!sameJson(acceptedUnitActorHistory(response, "attacker"), acceptedUnitActorHistory(response, "defender"))) {
      throw new Error(`${id} identical tactics selected different actor classes/positions by side`);
    }
  }
  await mkdir(conformanceDirectory, { recursive: true });
  const requestMetrics = [];
  const requestFileChecks = caseInputs.map(async (entry, index) => {
    if (!goldenCaseIds.has(entry.id)) return;
    const response = assertOk(simulationResponses[index], `simulate ${entry.id}`);
    checkDamageHpParity(response, entry.id);
    const serialized = JSON.stringify(simulationResponses[index]);
    const metrics = {
      id: entry.id,
      response_bytes: Buffer.byteLength(serialized),
      response_nodes: countNodes(simulationResponses[index]),
      ticks: response.result.final_tick,
      event_count: response.replay.frames.reduce((total, frame) => total + frame.events.length, 0),
    };
    requestMetrics.push(metrics);

    if (entry.id === "tower-pressure") {
      const destroyedTowers = Object.values(response.replay.frames.at(-1)?.visible_state?.entities ?? {})
        .filter((entity) => entity.entity_type === "tower" && domainInteger(entity.fields.hp) === 0).length;
      if (destroyedTowers === 0) throw new Error("tower-pressure did not destroy a tower in the production simulation");
      metrics.destroyed_towers = destroyedTowers;
    }
    if (entry.id === "deploy-reserve") {
      const deployedEvents = response.replay.frames.flatMap((frame) => frame.events)
        .filter((event) => event.event === "unit_deployed");
      if (deployedEvents.length !== 2) throw new Error(`deploy-reserve produced ${deployedEvents.length} deployments, expected 2`);
      const diagnostics = completeDiagnosticsById.get(entry.id)?.events ?? [];
      const acceptedDeploys = diagnostics.filter((event) => event.record.kind === "intent_accepted" && event.record.value.intent.capability === "deploy");
      if (acceptedDeploys.length !== 2) throw new Error(`deploy-reserve accepted ${acceptedDeploys.length} deploy intents, expected 2`);
      const deploymentTicks = deployedEvents.map((event) => response.replay.frames.find((frame) => frame.events.includes(event))?.tick);
      if (!sameJson(deploymentTicks, [4, 8])) throw new Error(`deploy-reserve deployment ticks were ${deploymentTicks}; expected [4, 8]`);
      const lastVisibleState = response.replay.frames.at(-1)?.visible_state;
      const deployedReserveIds = deployedEvents.map((event) => domainEntity(event.payload.unit));
      const finalDeployedReserveIds = deployedReserveIds.filter((entityId) => {
        const entity = lastVisibleState?.entities?.[entityId];
        return entity?.entity_type === "unit" && entity.fields.deployed?.value === true;
      });
      if (finalDeployedReserveIds.length !== 2) throw new Error("deployed reserve event IDs do not resolve to deployed units in final state");
      metrics.deployments = deployedEvents.map((event, index) => ({
        tick: deploymentTicks[index],
        unit: domainEntity(event.payload.unit),
        lane: event.payload.lane?.value,
      }));
    }

    const outputPath = resolve(conformanceDirectory, `${entry.id}.request.json`);
    const content = `${JSON.stringify(entry.request, null, 2)}\n`;
    if (updateRequests) {
      await writeFile(outputPath, content);
      return;
    }
    const existing = await readFile(outputPath, "utf8").catch((error) => {
      if (error?.code === "ENOENT") fail(`missing ${relative(repositoryRoot, outputPath)}; use --write-requests to generate real sim requests`);
      throw error;
    });
    if (!sameJson(JSON.parse(existing), entry.request)) {
      fail(`${relative(repositoryRoot, outputPath).split(sep).join("/")} is stale; use --write-requests after reviewing the change`);
    }
  });
  await Promise.all(requestFileChecks);
  for (const metrics of requestMetrics) {
    console.log(`PASS ${metrics.id}: ${metrics.ticks} ticks, ${metrics.event_count} events, ${metrics.response_bytes} bytes, ${metrics.response_nodes} nodes`);
  }
  console.log(`MAX saved run response: ${Math.max(...requestMetrics.map((metric) => metric.response_bytes))} bytes / ${Math.max(...requestMetrics.map((metric) => metric.response_nodes))} nodes`);
} finally {
  await rm(catalogModule.tempRoot, { recursive: true, force: true });
}
