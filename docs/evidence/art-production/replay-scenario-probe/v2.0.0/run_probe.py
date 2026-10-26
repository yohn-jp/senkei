#!/usr/bin/env python3
"""Rerun authored Next campaign scenarios through a pinned local Enbu dispatcher."""
from __future__ import annotations

import argparse
import collections
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[5]
DEFAULT_DISPATCHER = Path("/home/sophia/src/senkei/target/release/senkei-wasm-dispatch")
EXPECTED_DISPATCHER_SHA256 = "707ffe100a21fb80eff50b56ad394f050954e4e64b0a9ce09da4cbaf1a978bf3"
EXPECTED_RULESET_DIGEST = "c045f65b261939c866f7a08c18fe4d0dca24c81a0fdb07a4728f50eeb74e688f"
EXPECTED_SOURCE_SHA256 = {
    "player-protect-the-core": "b869fb6dc3fc3f98485d9fd27f7b137233ddb84b9b2ee5c9e0ce810910d6bda6",
    "npc-read-the-map": "8e646ad65230bfa540d3b8b90ee26ec1672cf744433bb55ad16a3e818dcd14ad",
    "npc-share-the-pressure": "636599f8c41befe8193d863e39a68a2dac4e936e328069fe894b7de873bfa5ab",
    "npc-bridge-approach": "72af4cc69578be6d2e45184276490adf74dd00854241b1cf9e1f6bcd53ab947d",
}
API_VERSION = {"major": 1, "minor": 0, "patch": 0}
PLAYER_ROSTER = ["F01", "F03", "F06", "R02", "R04"]
PLAYER_PARTITION = [1, 1, 1, 1, 1]
PLAYER_SOURCE_ID = "protect-the-core"
RECIPES = {
    "read-the-map": {
        "roster": ["R03", "F01", "R01", "F02", "R02"],
        "squads": [1, 1, 1, 1, 1],
        "start_nodes": None,
    },
    "share-the-pressure": {
        "roster": ["F01", "F02", "R01", "R02", "F03"],
        "squads": [2, 2, 1],
        "start_nodes": None,
    },
    "bridge-approach": {
        "roster": ["F01", "F02", "F03", "R01", "R03"],
        "squads": [5],
        "start_nodes": None,
    },
}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def compact_json(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def canonical_json(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def write_gzip_json(path: Path, value: object) -> dict[str, object]:
    raw = compact_json(value)
    with path.open("wb") as target:
        with gzip.GzipFile(filename="", fileobj=target, mode="wb", mtime=0, compresslevel=9) as zipped:
            zipped.write(raw)
    compressed = path.read_bytes()
    return {
        "sha256_uncompressed_json": digest(raw),
        "sha256_compressed": digest(compressed),
        "uncompressed_bytes": len(raw),
        "compressed_bytes": len(compressed),
    }


def envelope(request_id: str, operation: str, payload: object) -> dict[str, object]:
    return {
        "api_version": API_VERSION,
        "request_id": request_id,
        "operation": operation,
        "payload": payload,
    }


def dispatch(dispatcher: Path, requests: list[dict[str, object]]) -> list[dict[str, object]]:
    stdin = "".join(json.dumps(request, ensure_ascii=False, separators=(",", ":")) + "\n" for request in requests)
    process = subprocess.run([str(dispatcher)], input=stdin, capture_output=True, text=True, check=True)
    responses = [json.loads(line) for line in process.stdout.splitlines()]
    if len(responses) != len(requests):
        raise RuntimeError(f"dispatcher returned {len(responses)} responses for {len(requests)} requests")
    failures = [response for response in responses if not response.get("ok")]
    if failures:
        raise RuntimeError(json.dumps(failures, ensure_ascii=False)[:3000])
    return responses


def make_snapshot(
    package: dict[str, object],
    heroes_by_id: dict[str, dict[str, object]],
    artifact_id: str,
    roster: list[str],
    squad_sizes: list[int],
    node: str,
    program: dict[str, object],
) -> dict[str, object]:
    records = []
    index = 0
    for squad_number, squad_size in enumerate(squad_sizes, start=1):
        for _ in range(squad_size):
            catalog_id = roster[index]
            hero = heroes_by_id[catalog_id]
            skill_path = sorted(hero["skill_paths"])[0]
            records.append({
                "kind": "record",
                "value": {
                    "slot_id": {"kind": "string", "value": f"slot-{index + 1}"},
                    "catalog_id": {"kind": "string", "value": catalog_id},
                    "squad": {"kind": "string", "value": f"npc-squad-{squad_number}"},
                    "node": {"kind": "string", "value": node},
                    "skill_path": {"kind": "string", "value": skill_path},
                },
            })
            index += 1
    if index != 5 or len(roster) != 5 or sum(squad_sizes) != 5:
        raise ValueError("authored campaign roster must contain five Heroes")
    return {
        "schema_version": package["model_version"],
        "id": artifact_id,
        "revision": "1",
        "ruleset": package["ruleset"],
        "configuration": {"heroes": {"kind": "list", "value": records}},
        "program": program,
        "initial_memory": {},
    }


def observe_events(owner_replay: dict[str, object]) -> dict[str, object]:
    event_counts: collections.Counter[str] = collections.Counter()
    hero_events: list[dict[str, object]] = []
    dead: set[tuple[str, str, str]] = set()
    previous_ids: dict[tuple[str, str, str], str] = {}
    respawns: list[dict[str, object]] = []

    for frame in owner_replay.get("frames", []):
        tick = frame["tick"]
        entities = frame.get("visible_state", {}).get("entities", {})
        for event in frame.get("events", []):
            event_name = event.get("event", "unknown")
            event_counts[event_name] += 1
            entity = entities.get(event.get("entity"), {})
            fields = entity.get("fields", {})
            catalog = fields.get("catalog_id", {}).get("value")
            slot = fields.get("slot_id", {}).get("value")
            side = entity.get("owner", "unknown")
            if catalog in ("F01", "R01") and event_name in (
                "next.death", "next.level_up", "next.skill_acquired"
            ):
                hero_events.append({
                    "tick": tick,
                    "event": event_name,
                    "catalog_id": catalog,
                    "owner": side,
                    "slot_id": slot,
                    "skill_id": fields.get("skill_id", {}).get("value")
                        or event.get("payload", {}).get("skill", {}).get("value"),
                })
            if event_name == "next.death" and catalog in ("F01", "R01") and slot:
                dead.add((side, catalog, slot))

        for entity_id, entity in entities.items():
            if entity.get("entity_type") != "hero":
                continue
            fields = entity.get("fields", {})
            catalog = fields.get("catalog_id", {}).get("value")
            slot = fields.get("slot_id", {}).get("value")
            side = entity.get("owner", "unknown")
            hp = fields.get("hp", {}).get("value")
            if catalog not in ("F01", "R01") or not slot:
                continue
            key = (side, catalog, slot)
            previous = previous_ids.get(key)
            if previous is not None and previous != entity_id and key in dead and hp is not None and hp > 0:
                respawns.append({
                    "tick": tick,
                    "catalog_id": catalog,
                    "owner": side,
                    "slot_id": slot,
                    "new_entity_id": entity_id,
                    "node": fields.get("node", {}).get("value"),
                })
                dead.discard(key)
            previous_ids[key] = entity_id

    return {
        "frame_event_counts": dict(sorted(event_counts.items())),
        "F01_R01_events": hero_events,
        "F01_R01_respawns": respawns,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dispatcher", type=Path, default=Path(os.environ.get("SENKEI_NATIVE_DISPATCHER", DEFAULT_DISPATCHER)))
    parser.add_argument("--out-dir", type=Path, default=Path(__file__).resolve().parent / "captures")
    parser.add_argument("--allow-different-dispatcher", action="store_true", help="do not enforce the recorded binary SHA")
    args = parser.parse_args()
    dispatcher = args.dispatcher.expanduser().resolve()
    if not dispatcher.is_file():
        raise FileNotFoundError(f"native dispatcher not found: {dispatcher}")
    binary_sha = digest(dispatcher.read_bytes())
    if binary_sha != EXPECTED_DISPATCHER_SHA256 and not args.allow_different_dispatcher:
        raise RuntimeError(f"dispatcher SHA {binary_sha} differs from pinned {EXPECTED_DISPATCHER_SHA256}")

    evidence_dir = Path(__file__).resolve().parent
    args.out_dir.mkdir(parents=True, exist_ok=True)
    source_dir = Path(__file__).resolve().parent / "sources"
    source_by_id = {
        "protect-the-core": (source_dir / "player-protect-the-core.jinrei").read_text(encoding="utf-8"),
        **{
            case_id: (source_dir / f"npc-{case_id}.jinrei").read_text(encoding="utf-8")
            for case_id in RECIPES
        },
    }
    for source_id, source in source_by_id.items():
        frozen_name = "player-protect-the-core" if source_id == "protect-the-core" else f"npc-{source_id}"
        if digest(source.encode("utf-8")) != EXPECTED_SOURCE_SHA256[frozen_name]:
            raise RuntimeError(f"saved Jinrei source changed: {frozen_name}")
    package_response = dispatch(dispatcher, [envelope("next-ruleset", "next_ruleset", {})])[0]
    package = package_response["result"]
    ruleset_ref = package["ruleset"]
    if ruleset_ref["digest"] != EXPECTED_RULESET_DIGEST and not args.allow_different_dispatcher:
        raise RuntimeError(f"unexpected Next package digest: {ruleset_ref['digest']}")
    if ruleset_ref["id"] != "senkei.next" or ruleset_ref["version"].get("major") != 2:
        raise RuntimeError(f"unexpected Next package identity: {ruleset_ref}")
    next_rules = package["next"]
    heroes_by_id = {hero["id"]: hero for hero in next_rules["heroes"]}

    source_ids = [PLAYER_SOURCE_ID, *RECIPES.keys()]
    compiled = dispatch(dispatcher, [
        envelope(f"compile-{source_id}", "compile_text", {
            "ruleset_ref": ruleset_ref,
            "source": source_by_id[source_id],
        })
        for source_id in source_ids
    ])
    programs = {source_id: response["result"]["program"] for source_id, response in zip(source_ids, compiled)}
    summaries = []
    replay_schema_version = None
    for case_id, recipe in RECIPES.items():
        npc_source = source_by_id[case_id]
        attacker = make_snapshot(
            package, heroes_by_id, "probe-player-first-march", PLAYER_ROSTER,
            PLAYER_PARTITION, next_rules["map"]["attacker_base"], programs[PLAYER_SOURCE_ID],
        )
        defender = make_snapshot(
            package, heroes_by_id, f"npc-{case_id}", recipe["roster"], recipe["squads"],
            next_rules["map"]["defender_base"], programs[case_id],
        )
        match_id = f"art-natural-{case_id}"
        context = dispatch(dispatcher, [envelope(
            f"context-{case_id}", "new_match_context",
            {"ruleset_ref": ruleset_ref, "match_id": match_id},
        )])[0]["result"]
        request = envelope(f"simulate-{case_id}", "simulate", {
            "attacker": attacker,
            "defender": defender,
            "context": context,
            "include_diagnostics": True,
            "diagnostics_side": "attacker",
        })
        case_dir = args.out_dir / case_id
        case_dir.mkdir(parents=True, exist_ok=True)
        request_file = case_dir / "input.request.json.gz"
        request_hash = write_gzip_json(request_file, request)
        started = time.monotonic()
        response = dispatch(dispatcher, [request])[0]["result"]
        replay_schema_version = response["replay"].get("schema_version", replay_schema_version)
        elapsed = round(time.monotonic() - started, 2)
        owner_replay = response.get("owner_replays", {}).get("attacker")
        if owner_replay is None:
            raise RuntimeError(f"{case_id}: authorized attacker replay is missing")
        public = {"result": response["result"], "replay": response["replay"]}
        owner = {
            "authorized_side": response.get("authorized_side"),
            "result": response["result"],
            "replay": owner_replay,
        }
        public_hash = write_gzip_json(case_dir / "public-replay.json.gz", public)
        owner_hash = write_gzip_json(case_dir / "attacker-owner-replay.json.gz", owner)
        observation = observe_events(owner_replay)
        summary = {
            "case_id": case_id,
            "match_id": match_id,
            "ruleset": ruleset_ref,
            "max_ticks": context["max_ticks"],
            "outcome": response["result"]["outcome"],
            "termination_reason": response["result"]["termination_reason"],
            "final_tick": response["result"]["final_tick"],
            "final_state_digest": response["result"]["final_state_digest"],
            "replay_result_digest": response["replay"].get("result_digest"),
            "request_sha256_uncompressed_json": request_hash["sha256_uncompressed_json"],
            "request_sha256_canonical_json": digest(canonical_json(request)),
            "public_replay_sha256_uncompressed_json": public_hash["sha256_uncompressed_json"],
            "public_replay_sha256_canonical_json": digest(canonical_json(public)),
            "owner_replay_sha256_uncompressed_json": owner_hash["sha256_uncompressed_json"],
            "owner_replay_sha256_canonical_json": digest(canonical_json(owner)),
            "source_sha256": {
                "player": digest(source_by_id[PLAYER_SOURCE_ID].encode("utf-8")),
                "npc": digest(npc_source.encode("utf-8")),
            },
            "frame_count": len(response["replay"].get("frames", [])),
            "observed_events": observation,
            "native_dispatcher_sha256": binary_sha,
            "elapsed_seconds": elapsed,
        }
        (case_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        summaries.append(summary)
        print(json.dumps(summary, ensure_ascii=False), flush=True)

    wasm_path = ROOT / "apps/web/public/wasm/senkei_wasm.wasm"
    wasm_record = {
        "path": str(wasm_path),
        "sha256": digest(wasm_path.read_bytes()) if wasm_path.is_file() else None,
        "present_at_rerun": wasm_path.is_file(),
    }
    manifest = {
        "schema": "senkei-art-native-scenario-probe/v1",
        "source_head": subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True, capture_output=True, check=True).stdout.strip(),
        "core_tree": subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD:crates/enbu"], text=True, capture_output=True, check=True).stdout.strip(),
        "wasm_source_tree": subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD:crates/wasm"], text=True, capture_output=True, check=True).stdout.strip(),
        "native_dispatcher": {"path": str(dispatcher), "sha256": binary_sha},
        "wasm_artifact": wasm_record,
        "ruleset": ruleset_ref,
        "replay_schema_version": replay_schema_version,
        "campaign_code_sha256": digest((ROOT / "scenarios/next/campaign.ts").read_bytes()),
        "campaign_source_fixtures_sha256": digest((ROOT / "scenarios/next/source-fixtures.json").read_bytes()),
        "cases": summaries,
    }
    (args.out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"scenario probe failed: {error}", file=sys.stderr)
        raise
