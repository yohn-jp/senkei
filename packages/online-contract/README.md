# Official authority boundaries

This package provides provider-independent **server-side contracts and orchestration**, not an official service. It does not configure login, an asset store, a queue, a production Enbu worker, a settlement database, a rating formula, ticket policy, economic policy or replay access policy. A completed local simulation, a digest or a locally cached receipt does not establish an official result. `ONLINE.md` still describes official PvP as unimplemented.

## Match authority

An integrator must supply trusted implementations for every port. Their responsibilities are part of the security boundary:

- Authentication resolves credentials to an authenticated player; admission atomically checks ownership of the submitted attacker revision, resolves a registered immutable defense, enforces the chosen ticket and anti-abuse policy, and binds an idempotency key to one request and Match.
- The asynchronous worker receives retained complete snapshots, initial state, programs, package and authored World. `OfficialCorePort` must use the real core to recompute and verify the complete input digest, all relevant content and versions, execute Enbu, check the result digest and produce/verify its allowlisted public projection. Identity comparisons in this package do not replace those checks.
- `ReproducingCoreClientAdapter` connects the existing `CoreClient` reproduction and preflight operations, recomputes the snapshot and result identities, rejects owner-only channels, and re-executes the exact input to verify a stored public result and replay. This verification reruns the whole match on every check, so an eventual deployment must account for the cost. The supplied CoreClient itself must be a trusted server-side execution of the Rust core; a browser-supplied response or an arbitrary CoreClient is not authoritative.
- Settlement atomically persists the retained input, result, replay, ticket accounting and rating change. Its durable idempotency, serialization, conflict detection, provenance, recovery and inquiry must be implemented and verified by the provider. This package cannot establish those guarantees from a TypeScript interface. `pending` and `outcome_unknown` are not commits. The Match receipt grants no progression reward or entitlement.
- Replay access is a separate policy from publishing or forking tactics. Only a committed record with matching Match/input/result/RulePackage/paired World identities may be read. The core must verify the exact public projection's semantic event/field allowlist and visibility; structural checks alone cannot establish secrecy. Public result projection excludes CU and all private inputs and diagnostics.

`executeAdmittedMatch` and `inquireMatch` are authority-job operations; they are not public endpoints. Network adapters must authenticate and authorize any user-facing inquiry. `admitMatch` returns only a Match reference. `readPublishedMatch` performs its own viewer authentication when applicable and a separate replay-access check. All callbacks are explicitly injected: this package has no permissive default, in-memory authority, or provider dependency.

## Economic authority

`submitEconomicOperation` and `inquireEconomicOperation` use the same `OfficialRequest` and `OfficialServiceResponse` as the client. Authentication binds the request to the player and configured authority. A domain-separated SHA-256 binds every request field, including action and versioned policy, to the authenticated evidence. The same validation used by the client checks action-specific results; the verifier must authenticate the full envelope and prove that any issuance came from the official market maker. The response exposed to the client retains its opaque authority evidence.

`AtomicEconomyPort` owns the indivisible validation and commit: current ownership, draw rights, quotation, policy version, authorization, balance, one-time consumption and all related records must be checked inside the provider's durable serialized boundary. It must return the original result for an identical request, reject conflicting reuse, preserve an inquiry record, and never issue Libra for a player listing or trade. No numerical price, probability, entitlement, reward, currency quantity or service implementation is supplied here. A transport or commit failure is `outcome_unknown`; it is never treated as success. A known rejection must be returned with authenticated rejection evidence.

An accepted player listing is not a sale. `readEconomicOrder` separately authenticates the viewer and verifies an order-status record (`awaiting_buyer`, `filled`, or `cancelled`), requiring settlement references for a filled order. It does not resubmit or rewrite the original committed listing. A provider must enforce access and supply verifiable evidence; the contract supplies neither.

## Authenticated progression reads

`readOfficialProgression` covers post-match references, draw entitlements and pools, inventory, balances, market search, quotations, orders and Libra issuance statistics. A configured host supplies the principal, versioned policy, exact query, provider and verifier. The returned evidence is bound to a domain-separated digest of the complete query and authenticated player; only a matching verified payload is projected. An unconfigured host supplies no fabricated request or credentials and receives `unavailable`.

Inventory and balance totals, available amounts, prices, fees and probabilities are supplied as exact text with a provider-approved versioned format. This package does not parse them, choose precision or infer a zero. The verifier must establish that quantities, availability and filter evidence accurately reflect the authority's data. Empty and filtered-empty lists depend on the provider's authenticated unfiltered-result claim. Search prices are not commitments, a listing awaiting a buyer is not a filled sale, and cumulative issuance is distinct from trading volume.

`OfficialReadPanel` is a generic consumer of this contract. It never promotes a local Player into an official account; without a configured host it shows only the unavailable state. The fixture under `fixtures/` is a test-only synthetic provider, not a service or real official data.

The adapters reuse existing TypeScript core DTOs, identity hashing and response validation in `apps/web/src`. These are not a configured browser or service authority; moving the DTOs and pure validators to a shared contract package would remove this cross-layer dependency. `SimulationSnapshot` binds both Senkei snapshots and MatchContext; `ReproductionAssets` retains the actual RulePackage and World needed to revalidate and reproduce. A real adapter must also retain and resolve any match-affecting extension referenced by those artifacts.

## Verification

The unit tests use test doubles to exercise sequencing, identity checks, failure paths, publication boundaries and requirements placed on settlement adapters. They do **not** prove an actual authentication provider, durable atomic settlement, privacy policy, ranking fairness or end-to-end official service.

For a real core boundary smoke test, build `cargo build --locked -p senkei-wasm --bin senkei-wasm-dispatch`, then run `node packages/online-contract/native-smoke.mjs`. It creates a real one-tick Match through the Rust native dispatcher, exercises the CoreClient adapter, and rejects modified bytecode and a changed public replay. The settlement in this test is a test double, so it is not evidence of a deployed authority or economic system.

`node packages/online-contract/read-ui-smoke.mjs` exercises unavailable, configured read, filtered-empty, denial, retry and stale-response handling in Chromium with a synthetic test provider. Set `SENKEI_CHROMIUM_EXECUTABLE` to a suitable Chromium binary when the bundled Playwright browser is not runnable on the host.
