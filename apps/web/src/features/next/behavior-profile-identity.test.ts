import { expect, it } from 'vitest';
import { completeBehaviorProfile, localTrialBehavior } from '../../contracts/next-production';

it('emits canonical nullable Profile fields before freezing and hashing match input', () => {
  const inherited = { navigation: null, engagement: null, targeting: null, pursuit: null, survival: null, objective: null };
  const trial = localTrialBehavior('rules', ['F01', 'R01']);
  expect(trial.policy.hero_defaults).toEqual({F01:inherited,R01:inherited});
  expect(JSON.stringify(trial.policy.hero_defaults.F01)).toBe('{"navigation":null,"engagement":null,"targeting":null,"pursuit":null,"survival":null,"objective":null}');
  expect(completeBehaviorProfile({ targeting: 0, survival: -1 })).toEqual({...inherited,targeting:0,survival:-1});
  expect(trial.policy.hero_defaults.F01).not.toBe(trial.policy.hero_defaults.R01);
});
