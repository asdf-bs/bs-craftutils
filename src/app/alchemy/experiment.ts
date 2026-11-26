import { EFFECTS, HERBS } from './alchemy';
import { HerbTableInput, validateHerbTable } from './estimator';

export interface HerbEffectObservation {
  effectId: string;
  mixturePower: number;
}

export interface HerbExperimentInput {
  dominantHerbId: string;
  observations: HerbEffectObservation[];
  displayPrecision: number;
  effectsComplete: boolean;
  dominantMassKg?: number;
}

export interface HerbPowerInference {
  effectId: string;
  minPower: number;
  maxPower: number;
  midpointPower: number;
  existingPower?: number;
}

export interface HerbExperimentResult {
  errors: string[];
  estimates: HerbPowerInference[];
}

export const HERB_EXPERIMENT_STORAGE_KEY = 'alchemy.herb-experiments';
export const DEFAULT_EXPERIMENT_DISPLAY_PRECISION = 3;
export const DOMINANT_HERB_MASS_KG = (100 - (HERBS.length - 1)) / 100;
const OTHER_HERB_MASS_KG = 0.01;

export function validateHerbExperiment(experiment: HerbExperimentInput): string[] {
  const errors: string[] = [];
  if (!experiment || !HERBS.some(herb => herb.id === experiment.dominantHerbId)) errors.push('Select a valid dominant herb.');
  if (!experiment || !Array.isArray(experiment.observations)) return [...errors, 'Experiment observations are invalid.'];
  if (!Number.isInteger(experiment.displayPrecision) || experiment.displayPrecision < 0 || experiment.displayPrecision > 6) {
    errors.push('Display precision is invalid.');
  }
  if (typeof experiment.effectsComplete !== 'boolean') errors.push('Confirm whether the observed effect list is complete.');
  if (experiment.dominantMassKg !== undefined && experiment.dominantMassKg !== DOMINANT_HERB_MASS_KG && experiment.dominantMassKg !== 0.89) errors.push('Experiment herb mass is invalid.');
  if (experiment.effectsComplete && experiment.observations.length === 0) errors.push('Record at least one observed effect.');
  if (experiment.observations.length > EFFECTS.length) errors.push('An experiment cannot contain more unique effects than the effect catalog.');
  const ids = experiment.observations.map(item => item?.effectId);
  if (new Set(ids).size !== ids.length) errors.push('An experiment cannot contain the same effect twice.');
  for (const observation of experiment.observations) {
    if (!observation || !EFFECTS.some(effect => effect.id === observation.effectId)) {
      errors.push('Select a valid effect for each observation.');
      continue;
    }
    if (!Number.isFinite(observation.mixturePower) || observation.mixturePower < 0 || observation.mixturePower > 1) {
      errors.push('Observed mixture power must be from 0% to 100%.');
      continue;
    }
    const scale = 10 ** experiment.displayPrecision;
    if (Number.isInteger(experiment.displayPrecision) && Math.abs(observation.mixturePower * scale - Math.round(observation.mixturePower * scale)) > 1e-7) {
      const precisionDescription = experiment.displayPrecision === DEFAULT_EXPERIMENT_DISPLAY_PRECISION
        ? "the game's one-decimal percentage display"
        : 'the saved percentage display precision';
      errors.push(`Observed mixture powers must match ${precisionDescription}.`);
    }
  }
  if (!experiment.effectsComplete) errors.push('Confirm the observed effect list is complete before inferring herb powers.');
  return [...new Set(errors)];
}

export class HerbExperimentRepository {
  constructor(
    private readonly storage?: Storage,
    private readonly key: string = HERB_EXPERIMENT_STORAGE_KEY,
  ) {}

  list(): HerbExperimentInput[] {
    const value = this.storageApi.getItem(this.key);
    if (value === null) return [];
    let parsed: unknown;
    try { parsed = JSON.parse(value); }
    catch { throw new Error('Saved herb experiments are not valid JSON.'); }
    if (!Array.isArray(parsed)) throw new Error('Saved herb experiments are invalid.');
    for (const experiment of parsed) {
      if (!experiment || typeof experiment !== 'object' || validateHerbExperiment(experiment as HerbExperimentInput).length) {
        throw new Error('Saved herb experiments are invalid.');
      }
    }
    const experiments = parsed as HerbExperimentInput[];
    if (new Set(experiments.map(item => item.dominantHerbId)).size !== experiments.length) {
      throw new Error('Saved herb experiments contain duplicate herbs.');
    }
    return experiments.map(cloneExperiment);
  }

  save(experiment: HerbExperimentInput): void {
    const errors = validateHerbExperiment(experiment);
    if (errors.length) throw new Error(errors.join(' '));
    const experiments = this.list();
    const index = experiments.findIndex(item => item.dominantHerbId === experiment.dominantHerbId);
    const value = cloneExperiment(experiment);
    if (index === -1) experiments.push(value);
    else experiments[index] = value;
    this.storageApi.setItem(this.key, JSON.stringify(experiments));
  }

  private get storageApi(): Storage {
    return this.storage ?? localStorage;
  }
}

export function inferHerbPowers(experiment: HerbExperimentInput, herbTables: HerbTableInput[]): HerbExperimentResult {
  const errors = validateHerbExperiment(experiment);
  if (!Array.isArray(herbTables)) errors.push('Herb notebook data is invalid.');
  else for (const table of herbTables) errors.push(...validateHerbTable(table));
  if (errors.length) return { errors: [...new Set(errors)], estimates: [] };

  const byHerb = new Map(herbTables.map(table => [table.herbId, table]));
  const dominantTable = byHerb.get(experiment.dominantHerbId);
  const effectCount = experiment.observations.length;
  const sqrtEffectCount = Math.sqrt(effectCount);
  const measurementTolerance = 0.5 * (10 ** -experiment.displayPrecision) + 0.0005;
  const dominantMass = experiment.dominantMassKg ?? 0.89;
  const estimates: HerbPowerInference[] = [];

  for (const observation of experiment.observations) {
    let knownOtherMin = 0;
    let knownOtherMax = 0;
    let possibleUnknownHolders = 0;
    let guaranteedOtherHolders = 0;

    for (const herb of HERBS) {
      if (herb.id === experiment.dominantHerbId || (dominantMass === 0.89 && Number(herb.id.slice(5)) > 12)) continue;
      const table = byHerb.get(herb.id);
      const entry = table?.effects.find(effect => effect.effectId === observation.effectId);
      if (entry) {
        guaranteedOtherHolders++;
        if (entry.power === undefined) {
          knownOtherMin += OTHER_HERB_MASS_KG * 0.5;
          knownOtherMax += OTHER_HERB_MASS_KG;
        } else {
          knownOtherMin += OTHER_HERB_MASS_KG * entry.power;
          knownOtherMax += OTHER_HERB_MASS_KG * entry.power;
        }
      } else if (!table || !table.effectsComplete) {
        possibleUnknownHolders++;
        knownOtherMax += OTHER_HERB_MASS_KG;
      }
    }

    if (!guaranteedOtherHolders && !possibleUnknownHolders) continue;
    const minimumOtherContribution = knownOtherMin + (!guaranteedOtherHolders ? OTHER_HERB_MASS_KG * 0.5 : 0);
    const observedMin = Math.max(0, observation.mixturePower - measurementTolerance) * sqrtEffectCount;
    const observedMax = Math.min(1, observation.mixturePower + measurementTolerance) * sqrtEffectCount;
    const possibleMin = Math.max(0.5, (observedMin - knownOtherMax) / dominantMass);
    const possibleMax = Math.min(1, (observedMax - minimumOtherContribution) / dominantMass);
    const minPower = Math.ceil((possibleMin - 1e-8) * 100) / 100;
    const maxPower = Math.floor((possibleMax + 1e-8) * 100) / 100;
    if (minPower > maxPower) continue;

    const existingPower = dominantTable?.effects.find(effect => effect.effectId === observation.effectId)?.power;
    estimates.push({
      effectId: observation.effectId,
      minPower,
      maxPower,
      midpointPower: Math.round(((minPower + maxPower) / 2) * 100) / 100,
      ...(existingPower === undefined ? {} : { existingPower })
    });
  }
  return { errors: [], estimates };
}

function cloneExperiment(experiment: HerbExperimentInput): HerbExperimentInput {
  return {
    dominantHerbId: experiment.dominantHerbId,
    observations: experiment.observations.map(item => ({ ...item })),
    displayPrecision: experiment.displayPrecision,
    effectsComplete: experiment.effectsComplete,
    ...(experiment.dominantMassKg === undefined ? {} : { dominantMassKg: experiment.dominantMassKg })
  };
}