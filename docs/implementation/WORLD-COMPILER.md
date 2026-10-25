# World Definition Compiler implementation

`senkei-world` is an independent Rust producer for declarative World content. The authoring contract is implemented in `crates/senkei-world/src/definition.rs`; the architecture and gameplay authorities remain [WORLD-DEFINITION.md](../WORLD-DEFINITION.md) and [BATTLEFIELD.md](../BATTLEFIELD.md).

## Public API

Add the `senkei-world` crate and pass a typed `WorldDefinition` to `compile`, or strict JSON bytes to `compile_json`. Successful compilation returns `VerifiedWorld`; invalid JSON returns a parse error and invalid definitions return stable, sorted `WorldIssue` values with a code, path and message. Every authoring object rejects unknown JSON fields.

`WorldDefinition` keeps four independent authoring sections: `topology`, `metric`, `terrain` and `presentation`. All authoring collections are finite arrays so duplicate IDs can be diagnosed. Canonical output converts them into sorted maps. The topology declares explicit `entry_nodes`, directed or bidirectional links, fixed bridge sites and river-crossing kind. Metric data declares a positive integer WU length, typed track intervals and logical river-crossing progress intervals for each edge. Terrain profiles carry typed classifications and observation semantics; numeric effects remain in Senritsu.

Presentation declares a finite integer view box, one position per node, one ordered path per edge, river paths, typed visual regions, materials, lighting and foliage. Paths must terminate at their referenced nodes, stay inside the view box, and cannot cross another edge path away from a shared node. A river must intersect every edge marked as crossing it, and any edge path that visually crosses a river must have a matching logical crossing annotation.

## Validation and artifact identity

Generic validation checks nonempty stable IDs, duplicate IDs, endpoint and profile references, exact metric and presentation coverage, bridge-site membership, track ranges, crossing ranges, compatibility bounds, directed reachability from every authored entry as a set, screen bounds and presentation intersections. A successful `VerifiedWorld` can only be made by `compile`; its fields are private and it does not implement deserialization.

`WorldIdentity` pairs world ID, schema and compiler compatibility, selected validation profile, `WorldLogicDigest` and `WorldPresentationDigest`. The logic digest covers only canonical topology, metric and terrain. The presentation digest covers only canonical presentation. Both hashes use SHA-256 with a versioned domain prefix and canonical JSON bytes: declaration-order-independent collections are sorted into `BTreeMap`/`BTreeSet`, while ordered geometry retains point order. A view-only edit therefore leaves the logic digest fixed.

An author may select `senkei.battlefield.initial@1.0.0` in the definition. That versioned profile validates the 35-node/42-edge Battlefield, enumerated endpoint pairs, static allegiance and node roles, the 1000 WU base-to-base routes, fixed TOP/BOT/MID bridge membership, bridge-center versus ordinary-lane track sets, jungle's single corridor, camp leaves, and bridge-free jungle fords. Unknown profiles are errors. A generic world explicitly sets `validation_profile` to `null` to use only generic checks.

The authored example is [`initial-battlefield.json`](../../crates/senkei-world/fixtures/initial-battlefield.json). It records the approved static Battlefield graph and an illustrative presentation layout. It is not a replacement for the legacy runtime map and does not imply that Enbu, Senritsu, Jinrei or the renderer consume the compiled artifact yet.

## Verification

Focused contract checks run with:

```sh
cargo test -p senkei-world --locked
```

Workspace CI verifies the producer alongside the existing Rust and web applications.
