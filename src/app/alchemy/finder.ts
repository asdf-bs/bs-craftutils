import { EFFECTS, HERBS, RecipeIngredient } from './alchemy';
import {
  HerbTableInput,
  PotionEstimate,
  estimatePreparedPotion,
  preparePotionMixture,
  PreparedPotionMixture,
  summarizePotionProduct,
  validateHerbTable
} from './estimator';

export type MortarType = 'stone' | 'granite' | 'marble';

export interface CraftQualityInput {
  alchemySkill: number;
  tableQuality: number;
  mortarType: MortarType;
  mortarQuality: number;
  potQuality: number;
  stillQuality: number;
  waterQuality: number;
}

export interface PotionFinderInput {
  herbTables: HerbTableInput[];
  desiredEffectIds: string[];
  includeAdditionalEffects?: boolean;
  estimateQuality: boolean;
  quality: CraftQualityInput;
}

export interface PotionQualityEstimate {
  mixtureQuality: number;
  decoctionQuality: number;
  distillateQuality: number;
  decoctionDurationMultiplier: number;
  distillateDurationMultiplier: number;
}

export interface PotionCandidate {
  ingredients: RecipeIngredient[];
  effects: PotionEstimate['effects'];
  decoction: PotionEstimate;
  distillate: PotionEstimate;
  quality: PotionQualityEstimate | null;
}

export interface PotionFinderResult {
  errors: string[];
  warnings: string[];
  candidates: PotionCandidate[];
}

interface RankedPotionCandidate {
  ingredients: RecipeIngredient[];
  tables: HerbTableInput[];
  prepared: PreparedPotionMixture;
  balanceScore: number;
  strengthScore: number;
  intoxicationScore: number;
  key: string;
}

export interface PotionFinderSearchTask {
  readonly complete: boolean;
  readonly result: PotionFinderResult;
  processNext(subsetCount?: number): boolean;
}

export type PotionFinderWorkerRequest =
  | { type: 'search'; id: number; input: PotionFinderInput }
  | { type: 'cancel'; id: number };

export type PotionFinderWorkerResponse =
  | { type: 'result'; id: number; result: PotionFinderResult }
  | { type: 'error'; id: number; message: string };

const WATER_VOLUME_LITERS = 4;
const EFFECT_PRESENCE_THRESHOLD = 0.01;
const MAX_MORTAR_BONUS: Record<MortarType, number> = { stone: 0, granite: 5, marble: 10 };

export function effectMagnitudeForRanking(magnitude: number): number {
  return magnitude < EFFECT_PRESENCE_THRESHOLD ? 0 : magnitude;
}

export function skillWithBuffer(skill: number): number {
  return skill + 20 * Math.max(0, 1 - skill / 95);
}

export function craftedQuality(skill: number, toolQuality: number, materialQuality: number): number {
  const bufferedSkill = skillWithBuffer(skill);
  const made = Math.min(Math.floor((bufferedSkill + toolQuality + materialQuality) / 3), Math.floor(bufferedSkill));
  return Math.max(1, Math.min(100, made));
}

export function tableQualityBonus(quality: number): number {
  return Math.max(0, Math.min(5, Math.floor((quality - 50) / 10)));
}

export function mortarQualityBonus(type: MortarType, quality: number): number {
  return Math.floor(MAX_MORTAR_BONUS[type] * quality / 100);
}

export function durationFactor(quality: number): number {
  return quality >= 100 ? 2 : 0.5 + Math.max(1, Math.min(99, quality)) / 100;
}

export function findPotionRecipes(input: PotionFinderInput): PotionFinderResult {
  const task = createPotionFinderSearch(input);
  while (!task.complete) task.processNext(64);
  return task.result;
}

export function createPotionFinderSearch(input: PotionFinderInput): PotionFinderSearchTask {
  const errors: string[] = [];
  const warnings: string[] = [
    'These are approximate estimates and only model clean-water brewing and conventional 100° distillation; exact in-game behavior may differ.',
    'For each matching herb subset, search returns only its highest-ranked distribution among equal portions and quarter-step interpolations toward one-herb-dominant distributions; it does not optimize every possible quantity.',
    'For each herb combination, the finder keeps its best-balanced sampled ratio and returns every matching combination, ordered by balance and then average desired-effect strength. Each product magnitude below 1% is treated as absent for matching and ranking.',
    'Strength and intoxication ranges use the assumed random 0.50–1.00 herb-power range when powers are unknown; candidate ranking uses midpoint estimates, not probabilities.'
  ];
  const herbTables = Array.isArray(input?.herbTables) ? input.herbTables : [];
  const desiredEffectIds = Array.isArray(input?.desiredEffectIds) ? input.desiredEffectIds : [];
  const includeAdditionalEffects = input?.includeAdditionalEffects === true;

  if (!input || !Array.isArray(input.herbTables)) errors.push('Herb notebook data is invalid.');
  if (!desiredEffectIds.length) errors.push('Select at least one desired effect.');
  if (new Set(desiredEffectIds).size !== desiredEffectIds.length ||
      desiredEffectIds.some(id => !EFFECTS.some(effect => effect.id === id))) {
    errors.push('Desired effects must be valid and unique.');
  }
  if (typeof input?.estimateQuality !== 'boolean' ||
      (input?.includeAdditionalEffects !== undefined && typeof input.includeAdditionalEffects !== 'boolean')) {
    errors.push('Finder options are invalid.');
  }

  const tableIds = new Set<string>();
  for (const table of herbTables) {
    errors.push(...validateHerbTable(table));
    if (tableIds.has(table.herbId)) errors.push('Herb notebook contains duplicate herbs.');
    tableIds.add(table.herbId);
  }

  if (input?.estimateQuality) errors.push(...validateQualityInput(input.quality));
  if (errors.length) return completedTask({ errors: [...new Set(errors)], warnings: [], candidates: [] });

  const configuredTables = herbTables
    .filter(table => table.effects.length > 0)
    .sort((a, b) => HERBS.findIndex(herb => herb.id === a.herbId) - HERBS.findIndex(herb => herb.id === b.herbId));
  const unrecordedCount = HERBS.length - configuredTables.length;
  if (unrecordedCount) warnings.push(`${unrecordedCount} herb${unrecordedCount === 1 ? ' table is' : ' tables are'} unrecorded and excluded from the search.`);
  if (configuredTables.length < 2) errors.push('Enter effects for at least two herbs before searching.');
  if (configuredTables.some(table => !table.effectsComplete)) {
    warnings.push('Some recorded herb tables are incomplete. Unknown shared effects can change which recipes match, their strength and toxicity, and can hide a Growth intoxication surcharge.');
  }
  if (configuredTables.some(table => table.effects.some(effect => effect.power === undefined))) {
    warnings.push('One or more herb effect powers are unknown. Strength and any Growth intoxication surcharge are shown as ranges; matching and ranking use 0.75 as the midpoint for each missing power, so a range may straddle the 1% effect-presence cutoff. The random power distribution is unclear, so the ranges are not probability intervals. Record measured values or use the experiment tool to improve estimates.');
  }
  if (input?.estimateQuality) {
    warnings.push('Quality and duration use the configured skill and equipment values; herb quality defaults to 50 until changed for each herb. Quality does not change the strength or intoxication estimates.');
  }
  if (errors.length) return completedTask({ errors: [...new Set(errors)], warnings, candidates: [] });

  let mask = 0;
  let finalResult: PotionFinderResult | null = null;
  const subsetWinners: RankedPotionCandidate[] = [];
  const subsetLimit = 2 ** configuredTables.length;

  return {
    get complete(): boolean { return finalResult !== null; },
    get result(): PotionFinderResult {
      return finalResult ?? { errors: [], warnings, candidates: [] };
    },
    processNext(subsetCount = 1): boolean {
      if (finalResult) return true;
      const count = Number.isFinite(subsetCount) ? Math.max(1, Math.floor(subsetCount)) : 1;
      const endMask = Math.min(subsetLimit, mask + count);
      while (mask < endMask) {
        const currentMask = mask++;
        const selected = configuredTables.filter((_, index) => (currentMask & (1 << index)) !== 0);
        if (selected.length < 2 || !canContainDesiredEffects(selected, desiredEffectIds)) continue;

        let bestForSubset: RankedPotionCandidate | null = null;
        for (const ingredients of candidateDistributions(selected)) {
          const selectedTables = ingredients.map(ingredient => selected.find(table => table.herbId === ingredient.herbId)!);
          const prepared = preparePotionMixture(ingredients, selectedTables, WATER_VOLUME_LITERS);
          if (!prepared) continue;
          const decoction = summarizePotionProduct(prepared, 'decoction', WATER_VOLUME_LITERS, 1);
          const distillate = summarizePotionProduct(prepared, 'distillate', WATER_VOLUME_LITERS, 1);
          const requestedMagnitudes = desiredEffectIds.map(id => ({
            decoction: decoction.effects.find(effect => effect.effectId === id)?.doseMagnitude ?? 0,
            distillate: distillate.effects.find(effect => effect.effectId === id)?.doseMagnitude ?? 0
          }));
          if (!requestedMagnitudes.every(({ decoction: brew, distillate: spirit }) =>
            Math.max(effectMagnitudeForRanking(brew), effectMagnitudeForRanking(spirit)) > 0
          )) continue;
          if (!includeAdditionalEffects && prepared.effects.some(effect => !desiredEffectIds.includes(effect.effectId))) continue;

          const desiredStrengths = requestedMagnitudes.map(({ decoction: brew, distillate: spirit }) =>
            (effectMagnitudeForRanking(brew) + effectMagnitudeForRanking(spirit)) / 2
          );
          const ranked: RankedPotionCandidate = {
            ingredients,
            tables: selectedTables,
            prepared,
            strengthScore: desiredStrengths.reduce((sum, value) => sum + value, 0) / desiredStrengths.length,
            balanceScore: Math.min(...desiredStrengths) / Math.max(...desiredStrengths),
            intoxicationScore: (
              (decoction.intoxication.min + decoction.intoxication.max) / 2 +
              (distillate.intoxication.min + distillate.intoxication.max) / 2
            ) / 2,
            key: ingredients.map(item => `${item.herbId}:${item.amountKg.toFixed(2)}`).sort().join('|')
          };
          if (!bestForSubset || compareCandidates(ranked, bestForSubset) < 0) bestForSubset = ranked;
        }

        if (bestForSubset) {
          subsetWinners.push(bestForSubset);
        }
      }

      if (mask >= subsetLimit) {
        const finalCandidates = [...subsetWinners].sort(compareCandidates).map(candidate => {
          const ingredients = candidate.ingredients;
          const decoction = estimatePreparedProduct(candidate.prepared, 'decoction');
          const distillate = estimatePreparedProduct(candidate.prepared, 'distillate');
          return {
            ingredients,
            effects: decoction.effects,
            decoction,
            distillate,
            quality: input.estimateQuality ? estimatePotionQuality(ingredients, candidate.tables, input.quality) : null
          };
        });
        if (!finalCandidates.length) {
          warnings.push(includeAdditionalEffects
            ? 'No recipe in the tested herb subsets and quantity distributions contains all selected effects.'
            : 'No exact potion match was found in the tested herb subsets and quantity distributions.');
        }
        finalResult = { errors: [], warnings, candidates: finalCandidates };
      }
      return finalResult !== null;
    }
  };
}

function compareCandidates(a: RankedPotionCandidate, b: RankedPotionCandidate): number {
  return b.balanceScore - a.balanceScore ||
    b.strengthScore - a.strengthScore ||
    a.intoxicationScore - b.intoxicationScore ||
    a.key.localeCompare(b.key);
}

function completedTask(result: PotionFinderResult): PotionFinderSearchTask {
  return {
    complete: true,
    result,
    processNext: () => true
  };
}

function canContainDesiredEffects(tables: HerbTableInput[], desiredEffectIds: string[]): boolean {
  return desiredEffectIds.every(effectId =>
    tables.reduce((count, table) => count + Number(table.effects.some(effect => effect.effectId === effectId)), 0) >= 2
  );
}

function estimatePreparedProduct(prepared: PreparedPotionMixture, product: 'decoction' | 'distillate'): PotionEstimate {
  return estimatePreparedPotion(prepared, product, WATER_VOLUME_LITERS, 1);
}

export function estimatePotionQuality(
  ingredients: RecipeIngredient[],
  herbTables: HerbTableInput[],
  input: CraftQualityInput
): PotionQualityEstimate {
  const mass = ingredients.reduce((sum, item) => sum + item.amountKg, 0);
  const herbQuality = ingredients.reduce((sum, item, index) => {
    const table = herbTables[index];
    return sum + item.amountKg * (table.herbQuality ?? 50);
  }, 0) / mass;
  const mixtureQuality = Math.min(100,
    craftedQuality(input.alchemySkill, input.mortarQuality, herbQuality) +
    tableQualityBonus(input.tableQuality) +
    mortarQualityBonus(input.mortarType, input.mortarQuality));
  const waterMass = WATER_VOLUME_LITERS;
  const brewMaterialQuality = (mixtureQuality * mass + input.waterQuality * waterMass) / (mass + waterMass);
  const decoctionQuality = craftedQuality(input.alchemySkill, input.potQuality, brewMaterialQuality);
  const distillateQuality = Math.min(100,
    craftedQuality(input.alchemySkill, input.stillQuality, decoctionQuality) + tableQualityBonus(input.tableQuality));
  return {
    mixtureQuality,
    decoctionQuality,
    distillateQuality,
    decoctionDurationMultiplier: durationFactor(decoctionQuality),
    distillateDurationMultiplier: durationFactor(distillateQuality)
  };
}

function candidateDistributions(tables: HerbTableInput[]): RecipeIngredient[][] {
  const count = tables.length;
  const baseCents = Math.floor(100 / count);
  const remainder = 100 - baseCents * count;
  const equalCents = tables.map((_, index) => baseCents + (index < remainder ? 1 : 0));
  const equal = tables.map((table, index) => ({ herbId: table.herbId, amountKg: equalCents[index] / 100 }));
  const distributions = [equal];
  for (let heavyIndex = 0; heavyIndex < count; heavyIndex++) {
    const dominantCents = tables.map((_, index) => index === heavyIndex ? 100 - count + 1 : 1);
    for (let step = 1; step <= 4; step++) {
      const exactAmounts = equalCents.map((amount, index) =>
        amount + (dominantCents[index] - amount) * step / 4
      );
      const amounts = exactAmounts.map(Math.floor);
      const remainderOrder = exactAmounts.map((_, index) => index).sort((a, b) =>
        exactAmounts[b] - amounts[b] - (exactAmounts[a] - amounts[a]) ||
        Number(b === heavyIndex) - Number(a === heavyIndex) ||
        a - b
      );
      const remainingCents = 100 - amounts.reduce((sum, amount) => sum + amount, 0);
      for (let index = 0; index < remainingCents; index++) amounts[remainderOrder[index]]++;
      distributions.push(tables.map((table, index) => ({
        herbId: table.herbId,
        amountKg: amounts[index] / 100
      })));
    }
  }
  const unique = new Map<string, RecipeIngredient[]>();
  for (const distribution of distributions) {
    const key = distribution.map(item => `${item.herbId}:${item.amountKg.toFixed(2)}`).sort().join('|');
    unique.set(key, distribution);
  }
  return [...unique.values()];
}

export function validateQualityInput(input: CraftQualityInput): string[] {
  if (!input || typeof input !== 'object') return ['Quality settings are invalid.'];
  const errors: string[] = [];
  if (!Number.isInteger(input.alchemySkill) || input.alchemySkill < 0 || input.alchemySkill > 100) {
    errors.push('Alchemy skill must be a whole number from 0 to 100.');
  }
  if (!['stone', 'granite', 'marble'].includes(input.mortarType)) errors.push('Select a valid mortar type.');
  const qualities: Array<[string, number]> = [
    ['Alchemy table', input.tableQuality], ['Mortar', input.mortarQuality], ['Pot', input.potQuality],
    ['Still', input.stillQuality], ['Water', input.waterQuality]
  ];
  for (const [label, value] of qualities) {
    if (!Number.isInteger(value) || value < 1 || value > 100) errors.push(`${label} quality must be a whole number from 1 to 100.`);
  }
  return errors;
}