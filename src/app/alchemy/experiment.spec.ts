import { HERBS } from './alchemy';
import {
  DOMINANT_HERB_MASS_KG,
  HerbExperimentInput,
  HerbExperimentRepository,
  HERB_EXPERIMENT_STORAGE_KEY,
  inferHerbPowers
} from './experiment';
import { HerbTableInput } from './estimator';

function experiment(overrides: Partial<HerbExperimentInput> = {}): HerbExperimentInput {
  return {
    dominantHerbId: 'herb-1',
    observations: [{ effectId: 'effect-3', mixturePower: 0.809 }],
    displayPrecision: 3,
    effectsComplete: true,
    ...overrides
  };
}

describe('herb strength experiments', () => {
  it('validates one-decimal game percentages and retains legacy precision', () => {
    expect(inferHerbPowers(experiment({ observations: [{ effectId: 'effect-3', mixturePower: 0.809 }] }), []).errors).toEqual([]);
    expect(inferHerbPowers(experiment({ observations: [{ effectId: 'effect-3', mixturePower: 0.8091 }] }), []).errors)
      .toContain("Observed mixture powers must match the game's one-decimal percentage display.");
    const precise = experiment({ displayPrecision: 6, observations: [{ effectId: 'effect-3', mixturePower: 0.809123 }] });
    expect(inferHerbPowers(precise, []).errors).toEqual([]);
    expect(inferHerbPowers({ ...precise, observations: [{ effectId: 'effect-3', mixturePower: 0.8091234 }] }, []).errors)
      .toContain('Observed mixture powers must match the saved percentage display precision.');
  });

  it('uses the current recipe mass while preserving the original 12-herb recipe', () => {
    expect(DOMINANT_HERB_MASS_KG).toBe(0.86);
    const oldResult = inferHerbPowers(experiment(), []);
    const newResult = inferHerbPowers(experiment({ dominantMassKg: DOMINANT_HERB_MASS_KG }), []);
    expect(oldResult.estimates.length).toBe(1);
    expect(newResult.estimates.length).toBe(1);
    expect(newResult.estimates[0].maxPower).toBeGreaterThan(oldResult.estimates[0].maxPower);
  });
  it('infers a conservative rounded range accounting for recorded and possible co-herb effects', () => {
    const result = inferHerbPowers(experiment(), [
      { herbId: 'herb-2', effects: [{ effectId: 'effect-3', power: 0.8 }], effectsComplete: false }
    ]);
    expect(result.errors).toEqual([]);
    expect(result.estimates).toEqual([{
      effectId: 'effect-3', minPower: 0.79, maxPower: 0.9, midpointPower: 0.85
    }]);

    const impossible = inferHerbPowers(experiment({ observations: [{ effectId: 'effect-3', mixturePower: 0.1 }] }), [
      { herbId: 'herb-2', effects: [{ effectId: 'effect-3', power: 0.8 }], effectsComplete: false }
    ]);
    expect(impossible.errors).toEqual([]);
    expect(impossible.estimates).toEqual([]);
  });

  it('requires a complete observed list and a possible co-holder before inferring', () => {
    const incomplete = inferHerbPowers(experiment({ effectsComplete: false }), []);
    expect(incomplete.errors).toContain('Confirm the observed effect list is complete before inferring herb powers.');

    const noCoHolder: HerbTableInput[] = HERBS.slice(1).map(herb => ({
      herbId: herb.id,
      effects: ['effect-5', 'effect-6', 'effect-7', 'effect-8'].map(effectId => ({ effectId, power: 0.5 })),
      effectsComplete: true
    }));
    expect(inferHerbPowers(experiment(), noCoHolder).estimates).toEqual([]);
  });

  it('persists complete measurements and does not overwrite existing data on invalid input', () => {
    const key = `${HERB_EXPERIMENT_STORAGE_KEY}.test`;
    localStorage.removeItem(key);
    try {
      const repository = new HerbExperimentRepository(localStorage, key);
      repository.save(experiment());
      expect(new HerbExperimentRepository(localStorage, key).list()).toEqual([experiment()]);

      expect(() => repository.save(experiment({
        observations: [{ effectId: 'effect-3', mixturePower: 0.8091 }]
      }))).toThrowError("Observed mixture powers must match the game's one-decimal percentage display.");
      expect(repository.list()).toEqual([experiment()]);

      localStorage.setItem(key, '{invalid');
      expect(() => repository.save(experiment())).toThrowError('Saved herb experiments are not valid JSON.');
      expect(localStorage.getItem(key)).toBe('{invalid');
    } finally {
      localStorage.removeItem(key);
    }
  });

  it('loads and preserves existing experiments at their saved precision', () => {
    const key = `${HERB_EXPERIMENT_STORAGE_KEY}.legacy`;
    localStorage.removeItem(key);
    try {
      const repository = new HerbExperimentRepository(localStorage, key);
      const legacy = experiment({
        displayPrecision: 6,
        observations: [
          { effectId: 'effect-3', mixturePower: 0.809123 },
          { effectId: 'effect-5', mixturePower: 0.612345 }
        ]
      });
      repository.save(legacy);
      expect(repository.list()).toEqual([legacy]);
      expect(inferHerbPowers(repository.list()[0], []).errors).toEqual([]);
    } finally {
      localStorage.removeItem(key);
    }
  });
});