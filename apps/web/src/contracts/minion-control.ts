import type { CoreVersion } from './core';

/** Caller-authored, verified RulePackage declarations; no production vocabulary is supplied. */
export interface NextMinionControlDeclaration {
  readonly schema_version: 1;
  readonly version: CoreVersion;
  readonly test_only: true;
  readonly scope_resolution: 'lane_overrides_army';
  readonly capabilities: Readonly<Record<string, {
    readonly scope: {readonly kind:'army'} | {readonly kind:'lane';readonly values:Readonly<Record<string,'top'|'mid'|'bot'>>};
    readonly candidate: 'lane_waypoint';
  }>>;
}

export interface NextMinionControlMatch {
  readonly schema_version: 1;
  readonly ruleset_digest: string;
}
