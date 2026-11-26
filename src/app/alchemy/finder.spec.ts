import {
  effectMagnitudeForRanking,
  createPotionFinderSearch,
  estimatePotionQuality,
  findPotionRecipes,
  PotionCandidate,
  PotionFinderInput,
  tableQualityBonus,
  mortarQualityBonus,
  durationFactor
} from './finder';
import { estimatePotion, HerbTableInput } from './estimator';
import { EFFECTS, HERBS } from './alchemy';

function pairedTables(sharedEffects: Array<{ effectId: string; power: number }> = [{ effectId: 'effect-3', power: 0.9 }]): HerbTableInput[] {
  return [
    {
      herbId: 'herb-1',
      effects: [...sharedEffects, ...[{ effectId: 'effect-2', power: 0.5 }, { effectId: 'effect-4', power: 0.5 }].slice(0, 4 - sharedEffects.length)],
      effectsComplete: false
    },
    {
      herbId: 'herb-2',
      effects: [...sharedEffects.map(effect => ({ ...effect, power: 0.8 })), ...[{ effectId: 'effect-6', power: 0.5 }, { effectId: 'effect-7', power: 0.5 }].slice(0, 4 - sharedEffects.length)],
      effectsComplete: false
    }
  ];
}

function search(overrides: Partial<Parameters<typeof findPotionRecipes>[0]> = {}) {
  return findPotionRecipes({
    herbTables: pairedTables(),
    desiredEffectIds: ['effect-3'],
    includeAdditionalEffects: true,
    estimateQuality: false,
    quality: {
      alchemySkill: 50,
      tableQuality: 50,
      mortarType: 'stone',
      mortarQuality: 50,
      potQuality: 50,
      stillQuality: 50,
      waterQuality: 45
    },
    ...overrides
  });
}

interface BaselineRankedCandidate {
  candidate: PotionCandidate;
  balanceScore: number;
  strengthScore: number;
  intoxicationScore: number;
  key: string;
}

function baselineSearch(input: PotionFinderInput): PotionCandidate[] {
  const configuredTables = input.herbTables.filter(table => table.effects.length > 0)
    .sort((a, b) => HERBS.findIndex(herb => herb.id === a.herbId) - HERBS.findIndex(herb => herb.id === b.herbId));
  const candidates: BaselineRankedCandidate[] = [];
  for (let mask = 0; mask < 2 ** configuredTables.length; mask++) {
    const selected = configuredTables.filter((_, index) => (mask & (1 << index)) !== 0);
    if (selected.length < 2 || selected.length > 12) continue;
    const subsetCandidates: BaselineRankedCandidate[] = [];
    for (const ingredients of baselineDistributions(selected)) {
      const selectedTables = ingredients.map(ingredient => selected.find(table => table.herbId === ingredient.herbId)!);
      const estimateInput = { ingredients, herbTables: selectedTables, liquidVolumeLiters: 4, drinkVolumeLiters: 1 };
      const decoction = estimatePotion({ ...estimateInput, product: 'decoction' }).estimate;
      const distillate = estimatePotion({ ...estimateInput, product: 'distillate' }).estimate;
      if (!decoction || !distillate) continue;
      const requested = input.desiredEffectIds.map(effectId => ({
        decoction: decoction.effects.find(effect => effect.effectId === effectId)?.doseMagnitude ?? 0,
        distillate: distillate.effects.find(effect => effect.effectId === effectId)?.doseMagnitude ?? 0
      }));
      if (!requested.every(item => Math.max(effectMagnitudeForRanking(item.decoction), effectMagnitudeForRanking(item.distillate)) > 0)) continue;
      const strengths = requested.map(item =>
        (effectMagnitudeForRanking(item.decoction) + effectMagnitudeForRanking(item.distillate)) / 2
      );
      subsetCandidates.push({
        candidate: {
          ingredients,
          effects: decoction.effects,
          decoction,
          distillate,
          quality: input.estimateQuality ? estimatePotionQuality(ingredients, selectedTables, input.quality) : null
        },
        balanceScore: Math.min(...strengths) / Math.max(...strengths),
        strengthScore: strengths.reduce((sum, value) => sum + value, 0) / strengths.length,
        intoxicationScore: (
          (decoction.intoxication.min + decoction.intoxication.max) / 2 +
          (distillate.intoxication.min + distillate.intoxication.max) / 2
        ) / 2,
        key: ingredients.map(item => `${item.herbId}:${item.amountKg.toFixed(2)}`).sort().join('|')
      });
    }
    subsetCandidates.sort(compareBaseline);
    if (subsetCandidates.length) candidates.push(subsetCandidates[0]);
  }
  candidates.sort(compareBaseline);
  return candidates.map(item => item.candidate);
}

function compareBaseline(a: BaselineRankedCandidate, b: BaselineRankedCandidate): number {
  return b.balanceScore - a.balanceScore || b.strengthScore - a.strengthScore ||
    a.intoxicationScore - b.intoxicationScore || a.key.localeCompare(b.key);
}

function baselineDistributions(tables: HerbTableInput[]): Array<Array<{ herbId: string; amountKg: number }>> {
  const count = tables.length;
  const baseCents = Math.floor(100 / count);
  const remainder = 100 - baseCents * count;
  const equalCents = tables.map((_, index) => baseCents + (index < remainder ? 1 : 0));
  const distributions = [tables.map((table, index) => ({ herbId: table.herbId, amountKg: equalCents[index] / 100 }))];
  for (let heavyIndex = 0; heavyIndex < count; heavyIndex++) {
    const dominantCents = tables.map((_, index) => index === heavyIndex ? 100 - count + 1 : 1);
    for (let step = 1; step <= 4; step++) {
      const exactAmounts = equalCents.map((amount, index) => amount + (dominantCents[index] - amount) * step / 4);
      const amounts = exactAmounts.map(Math.floor);
      const remainderOrder = exactAmounts.map((_, index) => index).sort((a, b) =>
        exactAmounts[b] - amounts[b] - (exactAmounts[a] - amounts[a]) ||
        Number(b === heavyIndex) - Number(a === heavyIndex) || a - b
      );
      const remainingCents = 100 - amounts.reduce((sum, amount) => sum + amount, 0);
      for (let index = 0; index < remainingCents; index++) amounts[remainderOrder[index]]++;
      distributions.push(tables.map((table, index) => ({ herbId: table.herbId, amountKg: amounts[index] / 100 })));
    }
  }
  const unique = new Map<string, Array<{ herbId: string; amountKg: number }>>();
  for (const distribution of distributions) {
    const key = distribution.map(item => `${item.herbId}:${item.amountKg.toFixed(2)}`).sort().join('|');
    unique.set(key, distribution);
  }
  return [...unique.values()];
}

describe('potion finder', () => {
  it('matches the previous exhaustive scoring flow for known, unknown-power, Growth, and quality cases', () => {
    const quality = {
      alchemySkill: 73,
      tableQuality: 81,
      mortarType: 'granite' as const,
      mortarQuality: 64,
      potQuality: 57,
      stillQuality: 92,
      waterQuality: 44
    };
    const cases: PotionFinderInput[] = [
      { herbTables: pairedTables(), desiredEffectIds: ['effect-3'], includeAdditionalEffects: true, estimateQuality: false, quality },
      {
        herbTables: [
          { herbId: 'herb-1', effects: [{ effectId: 'effect-3' }, { effectId: 'effect-1', power: 0.75 }], effectsComplete: false },
          { herbId: 'herb-2', effects: [{ effectId: 'effect-3', power: 0.86 }, { effectId: 'effect-1' }], effectsComplete: false },
          { herbId: 'herb-3', effects: [{ effectId: 'effect-3', power: 0.68 }, { effectId: 'effect-5', power: 0.91 }], effectsComplete: false },
          { herbId: 'herb-4', effects: [{ effectId: 'effect-3', power: 0.72 }, { effectId: 'effect-5', power: 0.8 }], effectsComplete: false }
        ],
        desiredEffectIds: ['effect-3', 'effect-5'],
        includeAdditionalEffects: true,
        estimateQuality: false,
        quality
      },
      {
        herbTables: HERBS.slice(0, 5).map((herb, index) => ({
          herbId: herb.id,
          effects: [
            { effectId: 'effect-3', power: 0.55 + index * 0.09 },
            { effectId: index < 3 ? 'effect-1' : 'effect-5', power: index === 1 ? undefined : 0.7 + index * 0.03 }
          ],
          effectsComplete: false
        })),
        desiredEffectIds: ['effect-3'],
        includeAdditionalEffects: true,
        estimateQuality: true,
        quality
      }
    ];

    for (const testCase of cases) {
      const actual = findPotionRecipes(testCase);
      expect(actual.errors).toEqual([]);
      expect(actual.candidates.length).toBeGreaterThan(0);
      expect(actual.candidates).toEqual(baselineSearch(testCase));
    }
  });

  it('processes the same search incrementally in arbitrary subset-sized chunks', () => {
    const input = {
      herbTables: HERBS.slice(0, 5).map((herb, index) => ({
        herbId: herb.id,
        effects: [{ effectId: 'effect-3', power: 0.6 + index * 0.05 }],
        effectsComplete: false
      })),
      desiredEffectIds: ['effect-3'],
      estimateQuality: false,
      quality: {
        alchemySkill: 50,
        tableQuality: 50,
        mortarType: 'stone' as const,
        mortarQuality: 50,
        potQuality: 50,
        stillQuality: 50,
        waterQuality: 45
      }
    };
    const expected = findPotionRecipes(input);
    const task = createPotionFinderSearch(input);
    expect(task.complete).toBeFalse();
    while (!task.processNext(3)) { /* process bounded subset batches */ }
    expect(task.result).toEqual(expected);
  });

  it('searches herb subsets and bounded quantities, then estimates both 1 L products', () => {
    const result = search();
    expect(result.errors).toEqual([]);
    expect(result.candidates.length).toBe(1);

    const strongest = result.candidates[0];
    expect(strongest.ingredients).toEqual([
      { herbId: 'herb-1', amountKg: 0.99 },
      { herbId: 'herb-2', amountKg: 0.01 }
    ]);
    expect(strongest.decoction.productStrength).toBe(1);
    expect(strongest.decoction.drinkVolumeLiters).toBe(1);
    expect(strongest.decoction.effects[0].doseMagnitude).toBeCloseTo(0.539, 3);
    expect(strongest.distillate.productStrength).toBeCloseTo(4 / 3, 10);
    expect(strongest.distillate.availableVolumeLiters).toBe(1.2);
    expect(strongest.distillate.effects[0].doseMagnitude).toBeCloseTo(0.719, 3);
    expect(strongest.decoction.intoxication.min).toBe(16);
    expect(strongest.distillate.intoxication.min).toBeCloseTo(26.4, 8);
    expect(result.warnings.join(' ')).toContain('quantity');
    expect(result.warnings.join(' ')).toContain('highest-ranked distribution');
    expect(result.warnings.join(' ')).toContain('incomplete');
  });

  it('includes additional effects and uses desired-effect balance before strength', () => {
    const tables = pairedTables([
      { effectId: 'effect-3', power: 0.9 },
      { effectId: 'effect-5', power: 0.75 },
      { effectId: 'effect-8', power: 0.67 }
    ]);
    const result = search({ herbTables: tables, desiredEffectIds: ['effect-3', 'effect-5'] });
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0].effects.map(effect => effect.effectId).sort()).toEqual(['effect-3', 'effect-5', 'effect-8']);
    expect(result.candidates[0].ingredients).toEqual([
      { herbId: 'herb-1', amountKg: 0.01 },
      { herbId: 'herb-2', amountKg: 0.99 }
    ]);
  });

  it('defaults to exact effect matches and can include potions with additional effects', () => {
    const input: PotionFinderInput = {
      herbTables: pairedTables([
        { effectId: 'effect-3', power: 0.9 },
        { effectId: 'effect-5', power: 0.75 }
      ]),
      desiredEffectIds: ['effect-3'],
      estimateQuality: false,
      quality: {
        alchemySkill: 50,
        tableQuality: 50,
        mortarType: 'stone',
        mortarQuality: 50,
        potQuality: 50,
        stillQuality: 50,
        waterQuality: 45
      }
    };

    const exact = findPotionRecipes(input);
    const expanded = findPotionRecipes({ ...input, includeAdditionalEffects: true });

    expect(exact.errors).toEqual([]);
    expect(exact.candidates).toEqual([]);
    expect(exact.warnings.join(' ')).toContain('exact');
    expect(expanded.candidates.length).toBe(1);
    expect(expanded.candidates[0].effects.map(effect => effect.effectId).sort()).toEqual(['effect-3', 'effect-5']);
  });

  it('excludes additional shared effects even when their strength is below 1%', () => {
    const herbTables: HerbTableInput[] = [
      { herbId: 'herb-1', effects: [{ effectId: 'effect-10', power: 1 }], effectsComplete: false },
      { herbId: 'herb-2', effects: [{ effectId: 'effect-10', power: 0.5 }, { effectId: 'effect-8', power: 0.5 }], effectsComplete: false },
      { herbId: 'herb-3', effects: [{ effectId: 'effect-10', power: 0.5 }, { effectId: 'effect-8', power: 0.5 }], effectsComplete: false }
    ];
    const result = search({ herbTables, desiredEffectIds: ['effect-10'], includeAdditionalEffects: false });
    const expanded = search({ herbTables, desiredEffectIds: ['effect-10'], includeAdditionalEffects: true });
    const threeHerbCandidate = result.candidates.find(candidate => candidate.ingredients.length === 3);
    const expandedThreeHerbCandidate = expanded.candidates.find(candidate => candidate.ingredients.length === 3);

    expect(threeHerbCandidate).toBeUndefined();
    expect(expandedThreeHerbCandidate?.effects.map(effect => effect.effectId).sort()).toEqual(['effect-10', 'effect-8']);
    const weakExtra = estimatePotion({
      ingredients: [
        { herbId: 'herb-1', amountKg: 0.98 },
        { herbId: 'herb-2', amountKg: 0.01 },
        { herbId: 'herb-3', amountKg: 0.01 }
      ],
      herbTables,
      liquidVolumeLiters: 4,
      drinkVolumeLiters: 1,
      product: 'decoction'
    }).estimate!;
    expect(weakExtra.effects.find(effect => effect.effectId === 'effect-8')?.doseMagnitude)
      .toBeLessThan(0.01);

    const balancedExtra = estimatePotion({
      ingredients: [
        { herbId: 'herb-1', amountKg: 0.33 },
        { herbId: 'herb-2', amountKg: 0.33 },
        { herbId: 'herb-3', amountKg: 0.34 }
      ],
      herbTables,
      liquidVolumeLiters: 4,
      drinkVolumeLiters: 1,
      product: 'decoction'
    }).estimate!;
    expect(balancedExtra.effects.find(effect => effect.effectId === 'effect-8')?.doseMagnitude)
      .toBeGreaterThan(0.01);
  });

  it('prioritizes balanced desired effects over a stronger but uneven ratio', () => {
    const tables: HerbTableInput[] = [
      { herbId: 'herb-1', effects: [{ effectId: 'effect-3', power: 1 }, { effectId: 'effect-5', power: 0.6 }, { effectId: 'effect-2', power: 0.5 }, { effectId: 'effect-4', power: 0.5 }], effectsComplete: true },
      { herbId: 'herb-2', effects: [{ effectId: 'effect-3', power: 0.6 }, { effectId: 'effect-5', power: 0.9 }, { effectId: 'effect-6', power: 0.5 }, { effectId: 'effect-7', power: 0.5 }], effectsComplete: true }
    ];
    const result = search({ herbTables: tables, desiredEffectIds: ['effect-3', 'effect-5'] });
    const balanced = result.candidates[0];
    const uneven = estimatePotion({
      ingredients: [{ herbId: 'herb-1', amountKg: 0.62 }, { herbId: 'herb-2', amountKg: 0.38 }],
      herbTables: tables,
      liquidVolumeLiters: 4,
      drinkVolumeLiters: 1,
      product: 'decoction'
    }).estimate!;
    const desiredStrengths = (effects: typeof balanced.effects) => ['effect-3', 'effect-5'].map(id =>
      effects.find(effect => effect.effectId === id)!.doseMagnitude
    );
    const balanceScore = (values: number[]) => Math.min(...values) / Math.max(...values);

    expect(result.errors).toEqual([]);
    expect(balanced.ingredients).toEqual([
      { herbId: 'herb-1', amountKg: 0.38 },
      { herbId: 'herb-2', amountKg: 0.62 }
    ]);
    expect(desiredStrengths(uneven.effects).reduce((sum, value) => sum + value, 0))
      .toBeGreaterThan(desiredStrengths(balanced.decoction.effects).reduce((sum, value) => sum + value, 0));
    expect(balanceScore(desiredStrengths(balanced.decoction.effects)))
      .toBeGreaterThan(balanceScore(desiredStrengths(uneven.effects)));
  });

  it('samples intermediate ratios to find a more balanced desired-effect mixture', () => {
    const tables: HerbTableInput[] = [
      { herbId: 'herb-1', effects: [{ effectId: 'effect-3', power: 0.6 }, { effectId: 'effect-5', power: 0.5 }, { effectId: 'effect-2', power: 0.5 }, { effectId: 'effect-4', power: 0.5 }], effectsComplete: true },
      { herbId: 'herb-2', effects: [{ effectId: 'effect-3', power: 0.5 }, { effectId: 'effect-5', power: 0.8 }, { effectId: 'effect-6', power: 0.5 }, { effectId: 'effect-7', power: 0.5 }], effectsComplete: true }
    ];
    const result = search({ herbTables: tables, desiredEffectIds: ['effect-3', 'effect-5'] });

    expect(result.candidates[0].ingredients).toEqual([
      { herbId: 'herb-1', amountKg: 0.75 },
      { herbId: 'herb-2', amountKg: 0.25 }
    ]);
    const desired = result.candidates[0].effects.filter(effect => ['effect-3', 'effect-5'].includes(effect.effectId));
    expect(desired[0].doseMagnitude).toBeCloseTo(desired[1].doseMagnitude, 3);
  });

  it('treats magnitudes below 1% as absent and keeps exactly 1% present', () => {
    expect(effectMagnitudeForRanking(0.0099)).toBe(0);
    expect(effectMagnitudeForRanking(0.01)).toBe(0.01);
  });

  it('returns one best sampled ratio for every matching herb subset', () => {
    const additionalEffects = EFFECTS.filter(effect => effect.id !== 'effect-3').slice(0, 3);
    const herbTables: HerbTableInput[] = HERBS.slice(0, 4).map((herb, index) => ({
      herbId: herb.id,
      effects: [
        { effectId: 'effect-3', power: 0.6 + index * 0.1 },
        ...additionalEffects.map(effect => ({ effectId: effect.id, power: 0.6 }))
      ],
      effectsComplete: true
    }));
    const result = search({ herbTables });
    expect(result.errors).toEqual([]);
    expect(result.candidates.length).toBe(11);
    expect(result.candidates.every(candidate => candidate.decoction.effects.some(effect => effect.effectId === 'effect-3'))).toBeTrue();
    const ingredientSets = result.candidates.map(candidate => candidate.ingredients.map(item => item.herbId).sort().join('|'));
    expect(new Set(ingredientSets).size).toBe(result.candidates.length);
  });

  it('returns every matching sampled herb combination and displays them by balance', () => {
    const herbTables: HerbTableInput[] = [
      { herbId: 'herb-1', effects: [{ effectId: 'effect-3', power: 0.95 }, { effectId: 'effect-5', power: 0.55 }], effectsComplete: false },
      { herbId: 'herb-2', effects: [{ effectId: 'effect-3', power: 0.90 }, { effectId: 'effect-5', power: 0.60 }], effectsComplete: false },
      { herbId: 'herb-3', effects: [{ effectId: 'effect-3', power: 0.80 }, { effectId: 'effect-5', power: 0.70 }], effectsComplete: false },
      { herbId: 'herb-4', effects: [{ effectId: 'effect-3', power: 0.70 }, { effectId: 'effect-5', power: 0.80 }], effectsComplete: false },
      { herbId: 'herb-5', effects: [{ effectId: 'effect-3', power: 0.55 }, { effectId: 'effect-5', power: 0.95 }], effectsComplete: false }
    ];
    const desiredEffectIds = ['effect-3', 'effect-5'];
    const candidateKey = (candidate: ReturnType<typeof search>['candidates'][number]) =>
      candidate.ingredients.map(item => `${item.herbId}:${item.amountKg.toFixed(2)}`).sort().join('|');
    const scores = (candidate: ReturnType<typeof search>['candidates'][number]) => {
      const desiredStrengths = desiredEffectIds.map(effectId => {
        const decoction = candidate.decoction.effects.find(effect => effect.effectId === effectId)?.doseMagnitude ?? 0;
        const distillate = candidate.distillate.effects.find(effect => effect.effectId === effectId)?.doseMagnitude ?? 0;
        return (effectMagnitudeForRanking(decoction) + effectMagnitudeForRanking(distillate)) / 2;
      });
      return {
        strength: desiredStrengths.reduce((sum, value) => sum + value, 0) / desiredStrengths.length,
        balance: Math.min(...desiredStrengths) / Math.max(...desiredStrengths),
        intoxication: (
          (candidate.decoction.intoxication.min + candidate.decoction.intoxication.max) / 2 +
          (candidate.distillate.intoxication.min + candidate.distillate.intoxication.max) / 2
        ) / 2,
        key: candidateKey(candidate)
      };
    };
    const allSubsetBestCandidates = [];
    for (let mask = 0; mask < 2 ** herbTables.length; mask++) {
      const subset = herbTables.filter((_, index) => (mask & (1 << index)) !== 0);
      if (subset.length < 2) continue;
      const subsetCandidate = search({ herbTables: subset, desiredEffectIds }).candidates
        .find(candidate => candidate.ingredients.length === subset.length);
      if (subsetCandidate) allSubsetBestCandidates.push(subsetCandidate);
    }
    const expected = [...allSubsetBestCandidates]
      .sort((a, b) => {
        const aScore = scores(a);
        const bScore = scores(b);
        return bScore.balance - aScore.balance || bScore.strength - aScore.strength ||
          aScore.intoxication - bScore.intoxication || aScore.key.localeCompare(bScore.key);
      });
    const result = search({ herbTables, desiredEffectIds });

    expect(result.errors).toEqual([]);
    expect(result.candidates.length).toBe(26);
    expect(result.candidates.map(candidateKey)).toEqual(expected.map(candidateKey));
    expect(result.warnings.join(' ')).toContain('returns every matching combination');
  });

  it('returns tied combinations deterministically regardless of notebook order', () => {
    const herbTables: HerbTableInput[] = HERBS.slice(0, 5).map(herb => ({
      herbId: herb.id,
      effects: [{ effectId: 'effect-3', power: 0.9 }],
      effectsComplete: false
    }));
    const keys = (tables: HerbTableInput[]) => search({ herbTables: tables }).candidates.map(candidate =>
      candidate.ingredients.map(item => `${item.herbId}:${item.amountKg.toFixed(2)}`).sort().join('|')
    );

    expect(keys(herbTables).length).toBe(26);
    expect(keys([...herbTables].reverse())).toEqual(keys(herbTables));
  });

  it('chooses a deterministic ratio when sampled ratios tie on strength and intoxication', () => {
    const tables = pairedTables([{ effectId: 'effect-3', power: 0.9 }]).map(table => ({
      ...table,
      effects: table.effects.map(effect => ({ ...effect, power: 0.9 }))
    }));
    const first = search({ herbTables: tables }).candidates[0];
    const second = search({ herbTables: [...tables].reverse() }).candidates[0];

    expect(first.ingredients).toEqual([
      { herbId: 'herb-1', amountKg: 0.01 },
      { herbId: 'herb-2', amountKg: 0.99 }
    ]);
    expect(second.ingredients).toEqual(first.ingredients);
  });

  it('warns when unknown herb powers are used in estimates and recipe rankings', () => {
    const result = search({ herbTables: [
      { herbId: 'herb-1', effects: [{ effectId: 'effect-3' }], effectsComplete: false },
      { herbId: 'herb-2', effects: [{ effectId: 'effect-3', power: 0.8 }], effectsComplete: false }
    ] });
    expect(result.errors).toEqual([]);
    expect(result.warnings.join(' ')).toContain('matching and ranking use 0.75 as the midpoint for each missing power');
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].decoction.effects[0].doseMagnitudeRange.max)
      .toBeGreaterThan(result.candidates[0].decoction.effects[0].doseMagnitudeRange.min);
    expect(result.candidates[0].decoction.intoxication.max).toBeCloseTo(24, 8);
  });

  it('uses lower intoxication only to break ties in desired-effect strength', () => {
    const tables: HerbTableInput[] = [
      { herbId: 'herb-1', effects: [{ effectId: 'effect-3', power: 0.9 }, { effectId: 'effect-2', power: 0.5 }, { effectId: 'effect-4', power: 0.5 }, { effectId: 'effect-5', power: 0.5 }], effectsComplete: true },
      { herbId: 'herb-2', effects: [{ effectId: 'effect-3', power: 0.9 }, { effectId: 'effect-6', power: 0.5 }, { effectId: 'effect-7', power: 0.5 }, { effectId: 'effect-8', power: 0.5 }], effectsComplete: true },
      { herbId: 'herb-3', effects: [{ effectId: 'effect-3', power: 0.9 }, { effectId: 'effect-1', power: 0.5 }, { effectId: 'effect-9', power: 0.5 }, { effectId: 'effect-10', power: 0.5 }], effectsComplete: true },
      { herbId: 'herb-4', effects: [{ effectId: 'effect-3', power: 0.9 }, { effectId: 'effect-1', power: 0.5 }, { effectId: 'effect-11', power: 0.5 }, { effectId: 'effect-12', power: 0.5 }], effectsComplete: true }
    ];
    const result = search({ herbTables: tables });
    expect(result.candidates[0].ingredients.map(item => item.herbId)).toEqual(['herb-1', 'herb-2']);
    expect(result.candidates[0].decoction.intoxication.max).toBe(16);
  });

  it('rejects invalid notebook entries and invalid quality settings instead of ignoring them', () => {
    const invalidTable = pairedTables();
    invalidTable[0].effects[0].power = 1.2;
    const invalidNotebook = search({ herbTables: invalidTable });
    expect(invalidNotebook.candidates).toEqual([]);
    expect(invalidNotebook.errors).toContain('Herb effect powers must be from 0.50 to 1.00 in 0.01 steps.');

    const invalidQuality = search({ estimateQuality: true, quality: {
      alchemySkill: -1,
      tableQuality: 50,
      mortarType: 'stone',
      mortarQuality: 50,
      potQuality: 50,
      stillQuality: 50,
      waterQuality: 45
    } });
    expect(invalidQuality.errors).toContain('Alchemy skill must be a whole number from 0 to 100.');
  });

  it('applies configured crafting quality to duration multipliers without changing potion strength or intoxication', () => {
    const configuredQuality = {
      alchemySkill: 100,
      tableQuality: 100,
      mortarType: 'granite' as const,
      mortarQuality: 100,
      potQuality: 100,
      stillQuality: 100,
      waterQuality: 100
    };
    const baseline = search().candidates[0];
    const configured = search({
      herbTables: pairedTables().map(table => ({ ...table, herbQuality: 100 })),
      estimateQuality: true,
      quality: configuredQuality
    });
    expect(configured.errors).toEqual([]);
    const estimate = configured.candidates[0];
    expect(estimate.quality).toEqual(jasmine.objectContaining({
      mixtureQuality: 100,
      decoctionQuality: 100,
      distillateQuality: 100
    }));
    expect(estimate.quality!.decoctionDurationMultiplier).toBe(2);
    expect(estimate.quality!.distillateDurationMultiplier).toBe(2);
    expect(estimate.decoction.effects[0].doseMagnitude).toBe(baseline.decoction.effects[0].doseMagnitude);
    expect(estimate.distillate.intoxication.min).toBe(baseline.distillate.intoxication.min);
    expect(tableQualityBonus(99)).toBe(4);
    expect(mortarQualityBonus('granite', 60)).toBe(3);
    expect(durationFactor(50)).toBe(1);
    expect(durationFactor(100)).toBe(2);
  });
});