import { Component, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EFFECTS, HERBS } from './alchemy';
import {
  DEFAULT_EXPERIMENT_DISPLAY_PRECISION,
  DOMINANT_HERB_MASS_KG,
  HerbExperimentInput,
  HerbExperimentRepository,
  HerbPowerInference,
  inferHerbPowers
} from './experiment';
import {
  HerbTableInput,
  HerbTableRepository,
  PotionEstimate,
  validateHerbTable
} from './estimator';
import {
  CraftQualityInput,
  createPotionFinderSearch,
  estimatePotionQuality,
  MortarType,
  PotionCandidate,
  PotionFinderInput,
  PotionFinderResult,
  PotionFinderWorkerRequest,
  PotionFinderWorkerResponse,
  validateQualityInput
} from './finder';

const SEARCH_DEBOUNCE_MS = 120;
const FALLBACK_SUBSETS_PER_TICK = 6;
const QUALITY_WARNING = 'Quality and duration are approximate. Unconfigured herb quality defaults to 50; these estimates do not affect strength or intoxication.';

@Component({
  selector: 'app-alchemy-estimator',
  imports: [FormsModule],
  templateUrl: './estimator.component.html',
  styleUrl: './estimator.component.css'
})
export class AlchemyEstimatorComponent implements OnDestroy {
  readonly herbs = [...HERBS].sort((a, b) => a.name.localeCompare(b.name));
  readonly effects = [...EFFECTS];
  readonly dominantMassKg = DOMINANT_HERB_MASS_KG;
  private readonly repository = new HerbTableRepository();
  private readonly experimentRepository = new HerbExperimentRepository();
  private readonly effectSlots = new Map<string, string[]>();
  herbTables: HerbTableInput[] = [];
  selectedEffectIds: string[] = [];
  includeAdditionalEffects = false;
  estimateQuality = false;
  quality: CraftQualityInput = {
    alchemySkill: 50,
    tableQuality: 50,
    mortarType: 'stone',
    mortarQuality: 50,
    potQuality: 50,
    stillQuality: 50,
    waterQuality: 45
  };
  storageError = '';
  searchErrors: string[] = [];
  searchWarnings: string[] = [];
  candidates: PotionCandidate[] | null = null;
  isSearching = false;
  experiment: HerbExperimentInput = this.newExperiment(this.herbs[0].id);
  experimentErrors: string[] = [];
  experimentEstimates: HerbPowerInference[] = [];
  experimentNotice = '';
  private searchGeneration = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private searchWorker: Worker | null = null;
  private baseResult: PotionFinderResult | null = null;

  constructor() {
    try { this.herbTables = this.repository.list(); }
    catch { this.storageError = 'Unable to read saved herb tables. Existing saved data has not been changed.'; }
    try {
      const saved = this.experimentRepository.list();
      if (saved.length) this.experiment = saved[0];
      this.refreshExperimentInference();
    } catch {
      this.storageError ||= 'Unable to read saved herb experiments. Existing saved data has not been changed.';
    }
  }

  tableFor(herbId: string): HerbTableInput {
    const table = this.herbTables.find(item => item.herbId === herbId);
    return table ? {
      herbId: table.herbId,
      effects: table.effects.map(effect => ({ ...effect })),
      effectsComplete: table.effectsComplete,
      herbQuality: table.herbQuality ?? 50
    } : { herbId, effects: [], effectsComplete: false, herbQuality: 50 };
  }

  tableEffectsForDisplay(herbId: string): Array<{ effect: HerbTableInput['effects'][number]; index: number }> {
    let slots = this.effectSlots.get(herbId);
    if (!slots) {
      const effects = this.tableFor(herbId).effects;
      slots = Array.from({ length: 4 }, (_, index) => effects[index]?.effectId ?? '');
      this.effectSlots.set(herbId, slots);
    }
    return slots.map((effectId, index) => ({ effect: { effectId }, index }));
  }


  setEffect(herbId: string, index: number, effectId: string): void {
    const table = this.tableFor(herbId);
    const slots = this.tableEffectsForDisplay(herbId).map(row => row.effect.effectId);
    slots[index] = effectId;
    this.effectSlots.set(herbId, slots);
    const effects = slots.filter(Boolean).map(id => ({ effectId: id }));
    this.updateTable({ ...table, effects, effectsComplete: table.effectsComplete && effects.length === 4 });
  }

  removeEffect(herbId: string, index: number): void {
    this.setEffect(herbId, index, '');
  }

  setComplete(herbId: string, complete: boolean): void {
    const table = this.tableFor(herbId);
    if (table.effects.length === 4 && table.effects.every(effect => effect.effectId)) {
      this.updateTable({ ...table, effectsComplete: complete });
    }
  }

  setHerbQuality(herbId: string, quality: number): void {
    const table = this.tableFor(herbId);
    this.updateTable({ ...table, herbQuality: Number(quality) }, false);
  }

  isEffectSelected(herbId: string, effectId: string, exceptIndex = -1): boolean {
    return this.tableEffectsForDisplay(herbId).some(row => row.index !== exceptIndex && row.effect.effectId === effectId);
  }

  canMarkComplete(table: HerbTableInput): boolean {
    return table.effects.length === 4 && table.effects.every(effect => !!effect.effectId);
  }

  toggleDesiredEffect(effectId: string, selected: boolean): void {
    this.includeAdditionalEffects = false;
    this.selectedEffectIds = selected
      ? [...this.selectedEffectIds, effectId]
      : this.selectedEffectIds.filter(id => id !== effectId);
    this.refreshFinder();
  }

  setIncludeAdditionalEffects(include: boolean): void {
    this.includeAdditionalEffects = include;
    this.refreshFinder();
  }

  refreshFinder(): void {
    this.cancelActiveSearch();
    if (!this.selectedEffectIds.length) {
      this.clearResults();
      return;
    }
    this.baseResult = null;
    this.candidates = null;
    this.searchErrors = [];
    this.searchWarnings = [];
    this.isSearching = true;
    const generation = this.searchGeneration;
    const input: PotionFinderInput = {
      herbTables: this.tablesWithExperimentPowers(),
      desiredEffectIds: [...this.selectedEffectIds],
      includeAdditionalEffects: this.includeAdditionalEffects,
      estimateQuality: false,
      quality: { ...this.quality }
    };
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (generation === this.searchGeneration) this.startSearch(input, generation);
    }, SEARCH_DEBOUNCE_MS);
  }

  get displayedCandidates(): PotionCandidate[] {
    if (!this.candidates) return [];
    return this.candidates.map(candidate => ({
      ...candidate,
      ingredients: [...candidate.ingredients].sort((a, b) => this.herbName(a.herbId).localeCompare(this.herbName(b.herbId))),
      effects: [...candidate.effects].sort((a, b) =>
        Number(this.selectedEffectIds.includes(b.effectId)) - Number(this.selectedEffectIds.includes(a.effectId)) ||
        this.effectName(a.effectId).localeCompare(this.effectName(b.effectId)))
    }));
  }

  get showAdditionalEffectsOption(): boolean {
    if (this.searchErrors.length || !this.selectedEffectIds.length) return false;
    if (this.includeAdditionalEffects) return true;
    return !this.isSearching && this.baseResult !== null && this.baseResult.errors.length === 0 && this.candidates?.length === 0;
  }

  setMortarType(type: MortarType): void {
    this.quality = { ...this.quality, mortarType: type };
    this.invalidateResults();
  }

  invalidateResults(): void {
    this.applyCurrentQuality();
  }

  setExperimentHerb(herbId: string): void {
    try {
      this.experiment = this.experimentRepository.list().find(item => item.dominantHerbId === herbId) ?? this.newExperiment(herbId);
    } catch {
      this.experiment = this.newExperiment(herbId);
      this.experimentErrors = ['Unable to read saved experiments. Existing saved data has not been changed.'];
    }
    this.experimentNotice = '';
    this.refreshExperimentInference();
  }

  startNewExperiment(): void {
    this.experiment = this.newExperiment(this.experiment.dominantHerbId);
    this.experimentChanged();
  }

  observedPower(effectId: string): number | null {
    const power = this.experiment.observations.find(item => item.effectId === effectId)?.mixturePower;
    return power === undefined ? null : Number((power * 100).toFixed(6));
  }

  setEffectObservation(effectId: string, value: number | null): void {
    const observations = this.experiment.observations.filter(item => item.effectId !== effectId);
    if (value !== null) observations.push({ effectId, mixturePower: Number(value) / 100 });
    this.experiment = {
      ...this.experiment,
      observations: this.effects.flatMap(effect => observations.filter(item => item.effectId === effect.id)),
      displayPrecision: DEFAULT_EXPERIMENT_DISPLAY_PRECISION
    };
    this.experimentChanged();
  }

  recordExperiment(): void {
    try {
      this.experimentRepository.save(this.experiment);
      const result = inferHerbPowers(this.experiment, this.tablesWithoutPowers());
      this.experimentErrors = result.errors;
      this.experimentEstimates = result.estimates;
      this.experimentNotice = result.estimates.length
        ? 'Experiment saved; the finder uses midpoint estimates.'
        : 'Experiment saved; no power range could be inferred.';
      this.refreshFinder();
    } catch (error) {
      this.experimentErrors = [error instanceof Error ? error.message : 'Unable to save this experiment.'];
      this.experimentEstimates = [];
      this.experimentNotice = '';
    }
  }


  formatPercent(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
  }

  formatEffectMagnitude(estimate: PotionEstimate, effectId: string): string {
    const effect = estimate.effects.find(item => item.effectId === effectId);
    return effect ? this.formatPercentRange(effect.doseMagnitudeRange.min, effect.doseMagnitudeRange.max) : '—';
  }

  formatIntoxication(min: number, max: number): string {
    if (Math.abs(min - max) < 1e-8) return min.toFixed(1);
    let decimals = 1;
    while (decimals < 3 && min.toFixed(decimals) === max.toFixed(decimals)) decimals++;
    return `${min.toFixed(decimals)}–${max.toFixed(decimals)}`;
  }

  private formatPercentRange(min: number, max: number): string {
    if (Math.abs(min - max) < 1e-8) return this.formatPercent(min);
    let decimals = 1;
    while (decimals < 3 && (min * 100).toFixed(decimals) === (max * 100).toFixed(decimals)) decimals++;
    return `${(min * 100).toFixed(decimals)}%–${(max * 100).toFixed(decimals)}%`;
  }


  formatMultiplier(multiplier: number): string {
    return `×${multiplier.toFixed(2)}`;
  }

  herbName(id: string): string {
    return this.herbs.find(herb => herb.id === id)?.name ?? 'Select a herb';
  }

  effectName(id: string): string {
    return this.effects.find(effect => effect.id === id)?.name ?? id;
  }

  effectDescription(id: string): string | null {
    return this.effects.find(effect => effect.id === id)?.description ?? null;
  }

  private updateTable(table: HerbTableInput, affectsFinder = true): void {
    const index = this.herbTables.findIndex(item => item.herbId === table.herbId);
    if (index === -1) this.herbTables = [...this.herbTables, table];
    else this.herbTables = this.herbTables.map((item, tableIndex) => tableIndex === index ? table : item);

    if (!table.effects.some(effect => !effect.effectId) && !validateHerbTable(table).length) {
      try {
        this.repository.save(table);
        this.storageError = '';
      } catch {
        this.storageError = 'Unable to save herb tables in this browser. Your current entries remain available until you close this form.';
      }
    }
    if (affectsFinder) {
      this.includeAdditionalEffects = false;
      this.refreshFinder();
    } else this.applyCurrentQuality();
    this.refreshExperimentInference();
  }

  private clearResults(): void {
    this.baseResult = null;
    this.candidates = null;
    this.searchErrors = [];
    this.searchWarnings = [];
  }

  private experimentChanged(): void {
    this.experimentErrors = [];
    this.experimentEstimates = [];
    this.experimentNotice = '';
  }

  private refreshExperimentInference(): void {
    if (!this.experiment.effectsComplete || !this.experiment.observations.length) {
      this.experimentEstimates = [];
      return;
    }
    const result = inferHerbPowers(this.experiment, this.tablesWithoutPowers());
    this.experimentErrors = result.errors;
    this.experimentEstimates = result.estimates;
  }

  private tablesWithoutPowers(): HerbTableInput[] {
    return this.herbTables.map(table => ({ ...table, effects: table.effects.map(effect => ({ effectId: effect.effectId })) }));
  }

  private tablesWithExperimentPowers(): HerbTableInput[] {
    const tables = this.tablesWithoutPowers();
    let experiments: HerbExperimentInput[];
    try { experiments = this.experimentRepository.list(); } catch { return tables; }
    return tables.map(table => {
      const experiment = experiments.find(item => item.dominantHerbId === table.herbId);
      const estimates = experiment ? inferHerbPowers(experiment, tables).estimates : [];
      return { ...table, effects: table.effects.map(effect => {
        const estimate = estimates.find(item => item.effectId === effect.effectId);
        return estimate ? { ...effect, power: estimate.midpointPower } : effect;
      }) };
    });
  }

  ngOnDestroy(): void {
    this.cancelActiveSearch();
  }

  private startSearch(input: PotionFinderInput, generation: number): void {
    try {
      const worker = this.createFinderWorker();
      this.searchWorker = worker;
      worker.onmessage = (event: MessageEvent<PotionFinderWorkerResponse>) => {
        if (generation !== this.searchGeneration || event.data.id !== generation) return;
        if (event.data.type === 'result') {
          this.searchWorker = null;
          worker.terminate();
          this.finishSearch(event.data.result, generation);
        } else {
          this.startCooperativeFallback(input, generation);
        }
      };
      worker.onerror = () => this.startCooperativeFallback(input, generation);
      const request: PotionFinderWorkerRequest = { type: 'search', id: generation, input };
      worker.postMessage(request);
    } catch {
      this.startCooperativeFallback(input, generation);
    }
  }

  private createFinderWorker(): Worker {
    return new Worker(new URL('./finder.worker', import.meta.url), { type: 'module' });
  }

  private startCooperativeFallback(input: PotionFinderInput, generation: number): void {
    if (generation !== this.searchGeneration) return;
    this.searchWorker?.terminate();
    this.searchWorker = null;
    try {
      const task = createPotionFinderSearch(input);
      const processChunk = () => {
        this.fallbackTimer = null;
        if (generation !== this.searchGeneration) return;
        try {
          if (task.processNext(FALLBACK_SUBSETS_PER_TICK)) this.finishSearch(task.result, generation);
          else this.fallbackTimer = setTimeout(processChunk, 0);
        } catch (error) {
          this.finishSearch({
            errors: [error instanceof Error ? error.message : 'Potion search failed.'],
            warnings: [],
            candidates: []
          }, generation);
        }
      };
      processChunk();
    } catch (error) {
      this.finishSearch({
        errors: [error instanceof Error ? error.message : 'Potion search failed.'],
        warnings: [],
        candidates: []
      }, generation);
    }
  }

  private finishSearch(result: PotionFinderResult, generation: number): void {
    if (generation !== this.searchGeneration) return;
    if (this.fallbackTimer !== null) clearTimeout(this.fallbackTimer);
    this.fallbackTimer = null;
    this.isSearching = false;
    this.baseResult = result;
    this.applyCurrentQuality();
  }

  private applyCurrentQuality(): void {
    if (!this.baseResult) return;
    const result = this.baseResult;
    this.searchWarnings = [...result.warnings];
    const qualityErrors = this.estimateQuality ? validateQualityInput(this.quality) : [];
    this.searchErrors = [...new Set([...result.errors, ...qualityErrors])];
    if (this.searchErrors.length) {
      this.candidates = [];
      return;
    }
    if (!this.estimateQuality) {
      this.candidates = result.candidates.map(candidate => ({ ...candidate, quality: null }));
      return;
    }

    this.searchWarnings.push(QUALITY_WARNING);
    this.candidates = result.candidates.map(candidate => {
      const tables = candidate.ingredients.map(ingredient => this.herbTables.find(table => table.herbId === ingredient.herbId)!);
      return {
        ...candidate,
        quality: estimatePotionQuality(candidate.ingredients, tables, this.quality)
      };
    });
  }

  private cancelActiveSearch(): void {
    this.searchGeneration++;
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    if (this.fallbackTimer !== null) clearTimeout(this.fallbackTimer);
    this.debounceTimer = null;
    this.fallbackTimer = null;
    this.searchWorker?.terminate();
    this.searchWorker = null;
    this.isSearching = false;
  }

  private newExperiment(dominantHerbId: string): HerbExperimentInput {
    return {
      dominantHerbId,
      observations: [],
      displayPrecision: DEFAULT_EXPERIMENT_DISPLAY_PRECISION,
      effectsComplete: true,
      dominantMassKg: DOMINANT_HERB_MASS_KG
    };
  }
}