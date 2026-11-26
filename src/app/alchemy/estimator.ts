import { EFFECTS, HERBS, RecipeEffect, RecipeIngredient } from './alchemy';

export interface HerbEffectPower {
  effectId: string;
  power?: number;
}

export interface HerbTableInput {
  herbId: string;
  effects: HerbEffectPower[];
  effectsComplete: boolean;
  herbQuality?: number;
}

export type PotionProduct = 'decoction' | 'distillate';

export interface EstimateRange {
  min: number;
  max: number;
}

export interface PotionEstimateInput {
  ingredients: RecipeIngredient[];
  herbTables: HerbTableInput[];
  product: PotionProduct;
  liquidVolumeLiters: number;
  drinkVolumeLiters: number;
}

export interface EstimatedEffect {
  effectId: string;
  mixturePower: number;
  mixturePowerRange: EstimateRange;
  magnitude: number;
  magnitudeRange: EstimateRange;
  doseMagnitude: number;
  doseMagnitudeRange: EstimateRange;
}

export interface PotionEstimate {
  mixtureMassKg: number;
  brewStrength: number;
  productStrength: number;
  availableVolumeLiters: number;
  drinkVolumeLiters: number;
  toxicity: { min: number; max: number };
  intoxication: { min: number; max: number };
  effects: EstimatedEffect[];
  warnings: string[];
}

export interface PotionEstimateResult {
  errors: string[];
  estimate: PotionEstimate | null;
}

export interface PreparedPotionMixture {
  mixtureMassKg: number;
  brewStrength: number;
  toxicity: { min: number; max: number };
  effects: Array<{ effectId: string; power: number; powerRange: EstimateRange }>;
  warnings: string[];
}

export interface PotionProductSummary {
  productStrength: number;
  availableVolumeLiters: number;
  intoxication: { min: number; max: number };
  effects: Array<{ effectId: string; doseMagnitude: number }>;
}

export const HERB_TABLE_STORAGE_KEY = 'alchemy.herb-tables';
const MAX_HERB_EFFECTS = 4;
const MAX_BATCH_KG = 1;
const MAX_STILL_VOLUME_LITERS = 10;
const MAX_LIQUID_STRENGTH = 4 / 3;
const DISTILLATION_FACTOR = 3.3;
const DISTILLATE_VOLUME_SHARE = 0.3;
const INTOXICATION_PER_TOXICITY = 32;
const GROWTH_SURCHARGE = 70;

export function validateHerbTable(table: HerbTableInput): string[] {
  const errors: string[] = [];
  if (!table || !HERBS.some(herb => herb.id === table.herbId)) errors.push('Select a valid herb.');
  if (!table || !Array.isArray(table.effects) || typeof table.effectsComplete !== 'boolean') {
    errors.push('Herb effect data is invalid.');
    return errors;
  }

  const effects = table.effects;
  if (effects.length > MAX_HERB_EFFECTS) errors.push('Each herb can have at most four effects.');
  if (table.effectsComplete && effects.length !== MAX_HERB_EFFECTS) errors.push('A complete herb table must contain all four effects.');
  const effectIds = effects.map(effect => effect?.effectId);
  if (new Set(effectIds).size !== effectIds.length) errors.push('An herb cannot have the same effect twice.');
  for (const effect of effects) {
    if (!effect || !EFFECTS.some(item => item.id === effect.effectId)) errors.push('Select a valid effect for each herb effect.');
    if (!effect || (effect.power !== undefined && (!Number.isFinite(effect.power) || effect.power < 0.5 || effect.power > 1 ||
        Math.abs(effect.power * 100 - Math.round(effect.power * 100)) > 1e-8))) {
      errors.push('Herb effect powers must be from 0.50 to 1.00 in 0.01 steps.');
    }
  }
  if (table.herbQuality !== undefined && (!Number.isInteger(table.herbQuality) || table.herbQuality < 1 || table.herbQuality > 100)) {
    errors.push('Herb quality must be a whole number from 1 to 100.');
  }
  return errors;
}

export class HerbTableRepository {
  constructor(
    private readonly storage?: Storage,
    private readonly key: string = HERB_TABLE_STORAGE_KEY,
  ) {}

  list(): HerbTableInput[] {
    const value = this.storageApi.getItem(this.key);
    if (value === null) return [];
    let parsed: unknown;
    try { parsed = JSON.parse(value); }
    catch { throw new Error('Saved herb tables are not valid JSON.'); }
    if (!Array.isArray(parsed)) throw new Error('Saved herb tables are invalid.');
    for (const table of parsed) {
      if (!table || typeof table !== 'object' || validateHerbTable(table as HerbTableInput).length) {
        throw new Error('Saved herb tables are invalid.');
      }
    }
    const tables = parsed as HerbTableInput[];
    if (new Set(tables.map(table => table.herbId)).size !== tables.length) throw new Error('Saved herb tables contain duplicate herbs.');
    return tables.map(table => ({
      herbId: table.herbId,
      effects: table.effects.map(effect => ({ ...effect })),
      effectsComplete: table.effectsComplete,
      ...(table.herbQuality === undefined ? {} : { herbQuality: table.herbQuality })
    }));
  }

  save(table: HerbTableInput): void {
    const errors = validateHerbTable(table);
    if (errors.length) throw new Error(errors.join(' '));
    const tables = this.list();
    const index = tables.findIndex(item => item.herbId === table.herbId);
    const value = {
      herbId: table.herbId,
      effects: table.effects.map(effect => ({ ...effect })),
      effectsComplete: table.effectsComplete,
      ...(table.herbQuality === undefined ? {} : { herbQuality: table.herbQuality })
    };
    if (index === -1) tables.push(value);
    else tables[index] = value;
    this.storageApi.setItem(this.key, JSON.stringify(tables));
  }

  private get storageApi(): Storage {
    return this.storage ?? localStorage;
  }
}

export function estimatePotion(input: PotionEstimateInput): PotionEstimateResult {
  const errors: string[] = [];
  if (!input || !Array.isArray(input.ingredients) || input.ingredients.length < 2 || input.ingredients.length > HERBS.length) {
    errors.push(`Enter between two and ${HERBS.length} ingredients.`);
  }
  const ingredients = Array.isArray(input?.ingredients) ? input.ingredients : [];
  const tables = Array.isArray(input?.herbTables) ? input.herbTables : [];
  if (tables.length !== ingredients.length) errors.push('Enter effect data for each ingredient.');

  const herbs = new Set<string>();
  let mixtureMassKg = 0;
  ingredients.forEach((ingredient, index) => {
    if (!ingredient || !HERBS.some(herb => herb.id === ingredient.herbId)) {
      errors.push(`Select a valid herb for ingredient ${index + 1}.`);
    } else if (herbs.has(ingredient.herbId)) {
      errors.push('Ingredients must use different herbs.');
    } else {
      herbs.add(ingredient.herbId);
    }

    const amount = ingredient?.amountKg;
    const hundredths = amount * 100;
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(hundredths - Math.round(hundredths)) > 1e-8) {
      errors.push('Herb amounts must be positive multiples of 0.01 kg.');
    } else {
      mixtureMassKg += amount;
    }

    const table = tables[index];
    if (!table || !Array.isArray(table.effects) || typeof table.effectsComplete !== 'boolean') {
      errors.push(`Enter valid effect data for ingredient ${index + 1}.`);
      return;
    }
    if (table.herbId !== ingredient?.herbId) errors.push(`Effect data does not match ingredient ${index + 1}.`);
    errors.push(...validateHerbTable(table));
  });

  if (mixtureMassKg > MAX_BATCH_KG + 1e-8) errors.push('Herb amounts must total at most 1 kg.');
  if (input?.product !== 'decoction' && input?.product !== 'distillate') errors.push('Select a valid potion type.');
  if (!Number.isFinite(input?.liquidVolumeLiters) || input.liquidVolumeLiters <= 0) {
    errors.push('Clean water volume must be greater than zero.');
  }
  if (input?.product === 'distillate' && input.liquidVolumeLiters > MAX_STILL_VOLUME_LITERS) {
    errors.push('A conventional distillation charge cannot exceed the 10 L boiler capacity.');
  }
  if (!Number.isFinite(input?.drinkVolumeLiters) || input.drinkVolumeLiters <= 0 || input.drinkVolumeLiters > 1) {
    errors.push('Drink volume must be greater than zero and at most 1 L.');
  }
  if ((input?.product === 'decoction' || input?.product === 'distillate') && Number.isFinite(input?.liquidVolumeLiters) &&
      Number.isFinite(input?.drinkVolumeLiters)) {
    const availableVolume = input.product === 'distillate'
      ? input.liquidVolumeLiters * DISTILLATE_VOLUME_SHARE
      : input.liquidVolumeLiters;
    if (input.drinkVolumeLiters > availableVolume + 1e-8) errors.push('Drink volume cannot exceed the available product.');
  }
  if (errors.length) return { errors: [...new Set(errors)], estimate: null };

  const prepared = preparePotionMixture(ingredients, tables, input.liquidVolumeLiters);
  if (!prepared) return { errors: ['At least one effect must be present in two or more selected herb tables.'], estimate: null };
  return {
    errors: [],
    estimate: estimatePreparedPotion(prepared, input.product, input.liquidVolumeLiters, input.drinkVolumeLiters)
  };
}

export function preparePotionMixture(
  ingredients: RecipeIngredient[],
  tables: HerbTableInput[],
  liquidVolumeLiters: number
): PreparedPotionMixture | null {
  const mixtureMassKg = ingredients.reduce((sum, ingredient) => sum + ingredient.amountKg, 0);
  const effectsById = new Map<string, { holders: number; weightedPower: number; minWeightedPower: number; maxWeightedPower: number }>();
  const toxicity = { min: 0, max: 0 };
  let hasIncompleteTable = false;
  let hasUnknownPower = false;
  ingredients.forEach((ingredient, index) => {
    const table = tables[index];
    const hasGrowth = table.effects.some(effect => effect.effectId === 'effect-1');
    const toxicityMin = hasGrowth ? 0.75 : 0.5;
    const toxicityMax = hasGrowth || table.effectsComplete ? toxicityMin : 0.75;
    toxicity.min += ingredient.amountKg * toxicityMin;
    toxicity.max += ingredient.amountKg * toxicityMax;
    hasIncompleteTable ||= !table.effectsComplete;

    table.effects.forEach(effect => {
      const current = effectsById.get(effect.effectId) ?? {
        holders: 0,
        weightedPower: 0,
        minWeightedPower: 0,
        maxWeightedPower: 0
      };
      current.holders++;
      const power = effect.power ?? 0.75;
      hasUnknownPower ||= effect.power === undefined;
      current.weightedPower += ingredient.amountKg * power;
      current.minWeightedPower += ingredient.amountKg * (effect.power ?? 0.5);
      current.maxWeightedPower += ingredient.amountKg * (effect.power ?? 1);
      effectsById.set(effect.effectId, current);
    });
  });
  toxicity.min /= mixtureMassKg;
  toxicity.max /= mixtureMassKg;

  const shared = [...effectsById.entries()]
    .filter(([, value]) => value.holders >= 2)
    .map(([effectId, value]) => ({
      effectId,
      share: value.weightedPower / mixtureMassKg,
      minShare: value.minWeightedPower / mixtureMassKg,
      maxShare: value.maxWeightedPower / mixtureMassKg
    }));
  if (!shared.length) return null;

  const effectCount = shared.length;
  const effects = shared.map(({ effectId, share, minShare, maxShare }) => ({
    effectId,
    power: roundTo(share / Math.sqrt(effectCount), 3),
    powerRange: {
      min: roundTo(minShare / Math.sqrt(effectCount), 3),
      max: roundTo(maxShare / Math.sqrt(effectCount), 3)
    }
  }));
  const warnings = [
    'These are approximate estimates; exact in-game behavior has not been independently verified.',
    'The estimate covers clean-water brewing and conventional 100° distillation only; it does not simulate mushrooms, mixed brews, partial cuts, or duration.'
  ];
  if (hasIncompleteTable) {
    warnings.push('At least one herb table is incomplete. Unknown shared effects can change the sharing penalty, and an unknown shared Growth effect can add an intoxication surcharge; that hidden surcharge is not included in this estimate.');
  }
  if (hasUnknownPower) warnings.push('One or more effect powers are unknown. Strength and any Growth intoxication surcharge show bounds using the assumed 0.50–1.00 power range; their midpoint assumes 0.75 per missing power and is not saved as herb data. The random power distribution is unclear, so the range is not a probability interval.');

  return {
    mixtureMassKg,
    brewStrength: Math.min(1, mixtureMassKg / (liquidVolumeLiters * 0.25)),
    toxicity,
    effects,
    warnings
  };
}

export function summarizePotionProduct(
  prepared: PreparedPotionMixture,
  product: PotionProduct,
  liquidVolumeLiters: number,
  drinkVolumeLiters: number,
  effectIds: string[] = prepared.effects.map(effect => effect.effectId)
): PotionProductSummary {
  const availableVolumeLiters = product === 'distillate'
    ? liquidVolumeLiters * DISTILLATE_VOLUME_SHARE
    : liquidVolumeLiters;
  const productStrength = product === 'distillate'
    ? Math.min(MAX_LIQUID_STRENGTH, prepared.brewStrength * DISTILLATION_FACTOR)
    : prepared.brewStrength;
  const productCap = 0.6 * Math.max(1, Math.min(MAX_LIQUID_STRENGTH, productStrength));
  const servingFraction = Math.min(1, drinkVolumeLiters / 1);
  const distillationIntoxicationFactor = product === 'distillate' ? DISTILLATION_FACTOR * 0.5 : 1;
  const growthEffect = prepared.effects.find(effect => effect.effectId === 'effect-1');
  const growthMagnitudeRange = {
    min: growthEffect ? effectMagnitude(growthEffect.powerRange.min, productStrength, productCap) : 0,
    max: growthEffect ? effectMagnitude(growthEffect.powerRange.max, productStrength, productCap) : 0
  };
  const intoxication = {
    min: (INTOXICATION_PER_TOXICITY * prepared.toxicity.min * prepared.brewStrength * distillationIntoxicationFactor + GROWTH_SURCHARGE * growthMagnitudeRange.min) * servingFraction,
    max: (INTOXICATION_PER_TOXICITY * prepared.toxicity.max * prepared.brewStrength * distillationIntoxicationFactor + GROWTH_SURCHARGE * growthMagnitudeRange.max) * servingFraction
  };

  return {
    productStrength,
    availableVolumeLiters,
    intoxication,
    effects: effectIds.flatMap(effectId => {
      const effect = prepared.effects.find(item => item.effectId === effectId);
      if (!effect) return [];
      return [{ effectId, doseMagnitude: effectMagnitude(effect.power, productStrength, productCap) * servingFraction }];
    })
  };
}

export function estimatePreparedPotion(
  prepared: PreparedPotionMixture,
  product: PotionProduct,
  liquidVolumeLiters: number,
  drinkVolumeLiters: number
): PotionEstimate {
  const summary = summarizePotionProduct(prepared, product, liquidVolumeLiters, drinkVolumeLiters);
  const productCap = 0.6 * Math.max(1, Math.min(MAX_LIQUID_STRENGTH, summary.productStrength));
  const servingFraction = Math.min(1, drinkVolumeLiters / 1);
  return {
    mixtureMassKg: prepared.mixtureMassKg,
    brewStrength: prepared.brewStrength,
    productStrength: summary.productStrength,
    availableVolumeLiters: summary.availableVolumeLiters,
    drinkVolumeLiters,
    toxicity: prepared.toxicity,
    intoxication: summary.intoxication,
    effects: prepared.effects.map(effect => {
      const magnitude = effectMagnitude(effect.power, summary.productStrength, productCap);
      const magnitudeRange = {
        min: effectMagnitude(effect.powerRange.min, summary.productStrength, productCap),
        max: effectMagnitude(effect.powerRange.max, summary.productStrength, productCap)
      };
      return {
        effectId: effect.effectId,
        mixturePower: effect.power,
        mixturePowerRange: effect.powerRange,
        magnitude,
        magnitudeRange,
        doseMagnitude: magnitude * servingFraction,
        doseMagnitudeRange: {
          min: magnitudeRange.min * servingFraction,
          max: magnitudeRange.max * servingFraction
        }
      };
    }),
    warnings: prepared.warnings
  };
}

export function doseEffectsForRecipe(estimate: PotionEstimate): RecipeEffect[] {
  return estimate.effects.map(effect => ({ effectId: effect.effectId, strength: roundTo(effect.doseMagnitude, 3) }));
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function effectMagnitude(power: number, productStrength: number, productCap: number): number {
  return Math.min(productCap, 0.6 * power * productStrength);
}