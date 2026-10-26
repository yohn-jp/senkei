#!/usr/bin/env python3
"""Recompile a saved default-Jinrei AST and replay its legal lineup with current Core."""
from __future__ import annotations

import argparse
import copy
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

from run_probe import API_VERSION, ROOT, canonical_json, digest, dispatch, envelope, write_gzip_json, write_once

OLD_SOURCE_HEAD = "8728a8e47fd3c6669458445c2bb250701dd41166"
OLD_SEED_SHA256 = "e157b2f498b786b1e3b473ad1e3f5d43e715375986eec9daea3fcb8a6e3c8b42"
DEFAULT_SEED = ROOT / "docs/evidence/battlefield/graphics-completion/combat-event-proof-8728a8e/2026-10-25T12-41-35-921Z-pid3552341/actual-worker-snapshot.json.gz"
DEFAULT_OUT = Path(__file__).resolve().parent / "captures/core-replay-0.4-active-skill"
DEFAULT_DISPATCHER = Path(os.environ.get("SENKEI_NATIVE_DISPATCHER", "/home/sophia/src/senkei/target/local-codex/native/392200c6ec75f93d15e185abc308d34933ba82f5ee6b90322f0745df0299c48e"))


def call(dispatcher: Path, requests: list[dict[str, object]]) -> list[dict[str, object]]:
    responses = dispatch(dispatcher, requests)
    return [response["result"] for response in responses]


def field_value(record: object, key: str) -> object:
    if not isinstance(record, dict):
        return None
    value = record.get(key)
    return value.get("value") if isinstance(value, dict) else None


def source_ast_from_snapshot(side_snapshot: dict[str, object]) -> dict[str, object]:
    program = side_snapshot.get("program")
    if not isinstance(program, dict) or not isinstance(program.get("bytecode"), list):
        raise RuntimeError("saved worker snapshot has no compiled Jinrei bytecode")
    bytecode = bytes(program["bytecode"])
    if not bytecode.startswith(b"JINREI"):
        raise RuntimeError("saved worker snapshot does not contain the expected Jinrei bytecode")
    json_start = bytecode.find(b"{")
    if json_start < 0:
        raise RuntimeError("saved Jinrei bytecode has no embedded source AST")
    decoded = json.loads(bytecode[json_start:].decode("utf-8"))
    ast = decoded.get("source_ast")
    if not isinstance(ast, dict):
        raise RuntimeError("saved Jinrei bytecode did not expose its source AST")
    return ast


def formatted_source(dispatcher: Path, ruleset: dict[str, object], ast: dict[str, object], request_id: str) -> str:
    value = call(dispatcher, [envelope(request_id, "format_ast", {"ruleset_ref": ruleset, "ast": ast})])[0]
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for key in ("source", "text", "formatted"):
            source = value.get(key)
            if isinstance(source, str):
                return source
    raise RuntimeError(f"Core format_ast returned no source text: {json.dumps(value, ensure_ascii=False)[:1000]}")


def summarize_skill_events(replay: dict[str, object]) -> list[dict[str, object]]:
    observations: list[dict[str, object]] = []
    for frame in replay.get("frames", []):
        tick = frame.get("tick")
        entities = frame.get("visible_state", {}).get("entities", {})
        for event in frame.get("events", []):
            event_name = event.get("event")
            if event_name not in ("next.skill", "next.skill_damage"):
                continue
            entity = entities.get(event.get("entity"), {})
            fields = entity.get("fields", {})
            payload = event.get("payload", {})
            catalog_id = field_value(fields, "catalog_id")
            if catalog_id not in ("F01", "R01"):
                continue
            skill = field_value(payload, "skill") or field_value(fields, "skill_id")
            target = field_value(payload, "target") or field_value(payload, "target_id")
            observations.append({
                "tick": tick,
                "event": event_name,
                "catalog_id": catalog_id,
                "owner": entity.get("owner"),
                "entity_id": event.get("entity"),
                "skill_id": skill,
                "target": target,
            })
    return observations


def summarize_lifecycle(replay: dict[str, object]) -> dict[str, list[dict[str, object]]]:
    events: list[dict[str, object]] = []
    respawns: list[dict[str, object]] = []
    dead_at: dict[tuple[str, str], int] = {}
    previous: dict[tuple[str, str], tuple[str, int | None]] = {}
    for frame in replay.get("frames", []):
        tick = frame.get("tick")
        entities = frame.get("visible_state", {}).get("entities", {})
        for event in frame.get("events", []):
            event_name = event.get("event")
            if event_name not in ("next.death", "next.level_up", "next.skill_acquired"):
                continue
            entity = entities.get(event.get("entity"), {})
            fields = entity.get("fields", {})
            catalog_id = field_value(fields, "catalog_id")
            if catalog_id not in ("F01", "R01"):
                continue
            owner = entity.get("owner")
            events.append({
                "tick": tick,
                "event": event_name,
                "catalog_id": catalog_id,
                "owner": owner,
                "slot_id": field_value(fields, "slot_id"),
                "skill_id": field_value(fields, "skill_id")
                    or field_value(event.get("payload", {}), "skill"),
            })
            if event_name == "next.death" and owner is not None:
                dead_at[(owner, catalog_id)] = tick

        current: dict[tuple[str, str], tuple[str, int | None, str | None]] = {}
        for entity_id, entity in entities.items():
            if entity.get("entity_type") != "hero":
                continue
            fields = entity.get("fields", {})
            catalog_id = field_value(fields, "catalog_id")
            owner = entity.get("owner")
            if catalog_id not in ("F01", "R01") or owner is None:
                continue
            key = (owner, catalog_id)
            if key in current:
                raise RuntimeError(f"expected one {catalog_id} per owner for lifecycle matching; found duplicates at tick {tick}")
            current[key] = (entity_id, field_value(fields, "hp"), field_value(fields, "node"))
        for key, (entity_id, hp, node) in current.items():
            previous_id, previous_hp = previous.get(key, ("", None))
            if key in dead_at and hp is not None and hp > 0 and (entity_id != previous_id or previous_hp == 0):
                owner, catalog_id = key
                respawns.append({
                    "tick": tick,
                    "death_tick": dead_at.pop(key),
                    "catalog_id": catalog_id,
                    "owner": owner,
                    "new_entity_id": entity_id,
                    "node": node,
                })
            previous[key] = (entity_id, hp)
    return {"events": events, "respawns": respawns}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dispatcher", type=Path, default=DEFAULT_DISPATCHER)
    parser.add_argument("--source-head", default=os.environ.get("SENKEI_NATIVE_SOURCE_HEAD"))
    parser.add_argument("--seed", type=Path, default=DEFAULT_SEED)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    dispatcher = args.dispatcher.expanduser().resolve()
    seed_path = args.seed.expanduser().resolve()
    out_dir = args.out_dir.expanduser().resolve()
    if not dispatcher.is_file():
        raise FileNotFoundError(f"native dispatcher not found: {dispatcher}")
    if not seed_path.is_file():
        raise FileNotFoundError(f"saved source snapshot not found: {seed_path}")
    dispatcher_sha = digest(dispatcher.read_bytes())
    seed_bytes = seed_path.read_bytes()
    seed_sha = digest(seed_bytes)
    if seed_sha != OLD_SEED_SHA256:
        raise RuntimeError(f"saved default-Jinrei source snapshot SHA {seed_sha} differs from pinned {OLD_SEED_SHA256}")
    if not args.source_head:
        raise RuntimeError("SENKEI_NATIVE_SOURCE_HEAD or --source-head is required for Native provenance")

    native_crates_tree = subprocess.run(
        ["git", "-C", str(ROOT), "rev-parse", f"{args.source_head}:crates"],
        text=True, capture_output=True, check=True,
    ).stdout.strip()
    probe_crates_tree = subprocess.run(
        ["git", "-C", str(ROOT), "rev-parse", "HEAD:crates"],
        text=True, capture_output=True, check=True,
    ).stdout.strip()
    if native_crates_tree != probe_crates_tree:
        raise RuntimeError(f"Native crates tree {native_crates_tree} differs from probe HEAD tree {probe_crates_tree}")

    saved_snapshot = json.loads(gzip.decompress(seed_bytes).decode("utf-8"))
    if not isinstance(saved_snapshot, dict) or set(saved_snapshot) != {"attacker", "defender", "context"}:
        raise RuntimeError("saved source artifact is not the expected actual worker snapshot")
    old_context = saved_snapshot["context"]
    if old_context.get("max_ticks") != 600:
        raise RuntimeError("saved default-Jinrei scenario no longer has its original 600-tick limit")

    package = call(dispatcher, [envelope("active-skill-ruleset", "next_ruleset", {})])[0]
    ruleset = package["ruleset"]
    if ruleset.get("id") != "senkei.next" or ruleset.get("version", {}).get("major") != 2:
        raise RuntimeError(f"dispatcher returned an unsupported package identity: {ruleset}")
    heroes = {hero["id"]: hero for hero in package["next"]["heroes"]}

    programs: dict[str, dict[str, object]] = {}
    sources: dict[str, str] = {}
    ast_hashes: dict[str, str] = {}
    for side in ("attacker", "defender"):
        old_side = saved_snapshot[side]
        config = old_side.get("configuration", {}).get("heroes", {}).get("value", [])
        for entry in config:
            fields = entry.get("value", {})
            catalog_id = field_value(fields, "catalog_id")
            skill_path = field_value(fields, "skill_path")
            if catalog_id not in heroes or skill_path not in heroes[catalog_id]["skill_paths"]:
                raise RuntimeError(f"saved formation is unavailable in current Catalog: {side} {catalog_id} {skill_path}")
        ast = source_ast_from_snapshot(old_side)
        ast_hashes[side] = digest(canonical_json(ast))
        compiled = call(dispatcher, [envelope(
            f"active-skill-compile-{side}", "compile_ast", {"ruleset_ref": ruleset, "ast": ast},
        )])[0]
        program = compiled.get("program")
        if not isinstance(program, dict):
            raise RuntimeError(f"Core did not return a compiled program for {side}")
        source = formatted_source(dispatcher, ruleset, ast, f"active-skill-format-{side}")
        text_compiled = call(dispatcher, [envelope(
            f"active-skill-compile-text-{side}", "compile_text", {"ruleset_ref": ruleset, "source": source},
        )])[0].get("program")
        if not isinstance(text_compiled, dict) or text_compiled.get("content_digest") != program.get("content_digest"):
            raise RuntimeError(f"formatted current source does not compile to the same {side} program digest")
        programs[side] = program
        sources[side] = source

    new_snapshots: dict[str, dict[str, object]] = {}
    for side in ("attacker", "defender"):
        refreshed = copy.deepcopy(saved_snapshot[side])
        refreshed["schema_version"] = package["model_version"]
        refreshed["ruleset"] = ruleset
        refreshed["program"] = programs[side]
        refreshed["id"] = f"next-{side}-{ruleset['digest'][:12]}"
        new_snapshots[side] = refreshed

    match_id = old_context["match_id"]
    context = call(dispatcher, [envelope(
        "active-skill-context", "new_match_context", {"ruleset_ref": ruleset, "match_id": match_id},
    )])[0]
    if context.get("max_ticks") != 600:
        raise RuntimeError(f"current default context has max_ticks={context.get('max_ticks')}, expected the saved 600")

    preflight = call(dispatcher, [envelope("active-skill-preflight", "preflight", {
        "attacker": new_snapshots["attacker"],
        "defender": new_snapshots["defender"],
        "context": context,
    })])[0]
    if preflight is not None:
        raise RuntimeError(f"current Core rejected the saved default formation/source during preflight: {preflight}")

    request = envelope("active-skill-simulate", "simulate", {
        "attacker": new_snapshots["attacker"],
        "defender": new_snapshots["defender"],
        "context": context,
        "include_diagnostics": True,
        "diagnostics_side": "attacker",
    })
    response = call(dispatcher, [request])[0]
    result = response["result"]
    public = {"result": result, "replay": response["replay"]}
    owner_replay = response.get("owner_replays", {}).get("attacker")
    if not isinstance(owner_replay, dict):
        raise RuntimeError("current Core did not return the authorized attacker replay")
    owner = {"authorized_side": response.get("authorized_side"), "result": result, "replay": owner_replay}
    if result.get("match_id") != match_id:
        raise RuntimeError("simulation returned a different match ID")

    skill_observations = summarize_skill_events(owner_replay)
    public_skill_observations = summarize_skill_events(response["replay"])
    lifecycle = summarize_lifecycle(owner_replay)
    output_directory = out_dir
    output_directory.mkdir(parents=True, exist_ok=True)
    request_artifact = write_gzip_json(output_directory / "native-request.json.gz", request)
    snapshot_artifact = write_gzip_json(output_directory / "browser-snapshot.json.gz", {
        "attacker": new_snapshots["attacker"],
        "defender": new_snapshots["defender"],
        "context": context,
    })
    owner_artifact = write_gzip_json(output_directory / "attacker-owner-replay.json.gz", owner)
    public_artifact = write_gzip_json(output_directory / "public-replay.json.gz", public)
    for side in ("attacker", "defender"):
        write_once(output_directory / f"{side}.jinrei", sources[side].encode("utf-8"))

    wasm_path = ROOT / "apps/web/public/wasm/senkei_wasm.wasm"
    wasm_sha = digest(wasm_path.read_bytes()) if wasm_path.is_file() else None
    output_manifest = {
        "schema": "senkei-art-active-skill-probe/v1",
        "probe_repository": str(ROOT),
        "source_head": subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True, capture_output=True, check=True).stdout.strip(),
        "native_build_source_head": args.source_head,
        "native_build_crates_tree": native_crates_tree,
        "probe_crates_tree": probe_crates_tree,
        "old_source_revision": OLD_SOURCE_HEAD,
        "old_seed_snapshot_sha256": seed_sha,
        "old_ruleset": saved_snapshot["attacker"]["ruleset"],
        "old_match_id": match_id,
        "max_ticks": context["max_ticks"],
        "formation": {
            side: [
                {key: field_value(entry["value"], key) for key in ("slot_id", "catalog_id", "squad", "node", "skill_path")}
                for entry in saved_snapshot[side]["configuration"]["heroes"]["value"]
            ]
            for side in ("attacker", "defender")
        },
        "native_dispatcher": {"path": str(dispatcher), "sha256": dispatcher_sha},
        "wasm_artifact": {"path": str(wasm_path), "sha256": wasm_sha},
        "ruleset": ruleset,
        "replay_schema_version": response["replay"].get("schema_version"),
        "programs": {
            side: {
                "source_ast_canonical_sha256": ast_hashes[side],
                "formatted_source_sha256": digest(sources[side].encode("utf-8")),
                "compiled_program_digest": programs[side]["content_digest"],
            }
            for side in ("attacker", "defender")
        },
        "preflight": "PASS",
        "result": {key: result.get(key) for key in ("match_id", "outcome", "termination_reason", "final_tick", "final_state_digest")},
        "replay": {"ruleset": ruleset, "result_digest": response["replay"].get("result_digest")},
        "owner_replays": {"attacker": {"result_digest": owner_replay.get("result_digest")}},
        "hero_lifecycle": lifecycle,
        "active_skill_events": skill_observations,
        "public_active_skill_events": public_skill_observations,
        "artifacts": {
            "native_request": request_artifact,
            "browser_snapshot": snapshot_artifact,
            "owner_replay": owner_artifact,
            "public_replay": public_artifact,
        },
        "acceptance_scope": "Core 0.4 native replay only. Browser integration, Battlefield pixels, expected-size auto-LOD, and pixel determinism are separate checks.",
    }
    write_once(output_directory / "manifest.json", (json.dumps(output_manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    print(json.dumps({
        "manifest": str(output_directory / "manifest.json"),
        "ruleset_digest": ruleset["digest"],
        "match_id": match_id,
        "final_tick": result.get("final_tick"),
        "final_state_digest": result.get("final_state_digest"),
        "replay_result_digest": response["replay"].get("result_digest"),
        "hero_lifecycle_events": len(lifecycle["events"]),
        "hero_respawns": lifecycle["respawns"],
        "F01_R01_active_skill_events": len(skill_observations),
        "public_F01_R01_active_skill_events": len(public_skill_observations),
        "attacker_F01_R01_active_skill_ticks": sorted({
            event["tick"] for event in skill_observations
            if event["owner"] == "attacker"
        }),
        "defender_F01_R01_active_skill_ticks": sorted({
            event["tick"] for event in skill_observations
            if event["owner"] == "defender"
        }),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"active-skill probe failed: {error}", file=sys.stderr)
        raise
