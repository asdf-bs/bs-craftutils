import { fakeAsync, flush, TestBed, tick } from '@angular/core/testing';
import { AlchemyEstimatorComponent } from './estimator.component';
import { HERB_EXPERIMENT_STORAGE_KEY, HerbPowerInference } from './experiment';
import { EFFECTS, HERBS } from './alchemy';
import {
  doseEffectsForRecipe,
  estimatePotion,
  HERB_TABLE_STORAGE_KEY,
  HerbTableInput,
  HerbTableRepository,
  PotionEstimateInput
} from './estimator';

function tables(effectsComplete = true): HerbTableInput[] {
  return [
    { herbId: 'herb-1', effects: [
      { effectId: 'effect-3', power: 0.9 }, { effectId: 'effect-5', power: 0.7 },
      { effectId: 'effect-2', power: 0.5 }, { effectId: 'effect-4', power: 0.5 }
    ], effectsComplete },
    { herbId: 'herb-2', effects: [
      { effectId: 'effect-3', power: 0.8 }, { effectId: 'effect-5', power: 0.6 },
      { effectId: 'effect-6', power: 0.5 }, { effectId: 'effect-7', power: 0.5 }
    ], effectsComplete }
  ];
}

function input(overrides: Partial<PotionEstimateInput> = {}): PotionEstimateInput {
  return {
    ingredients: [{ herbId: 'herb-1', amountKg: 0.5 }, { herbId: 'herb-2', amountKg: 0.5 }],
    herbTables: tables(),
    product: 'decoction',
    liquidVolumeLiters: 1,
    drinkVolumeLiters: 1,
    ...overrides
  };
}

function forceSearchFallback(component: AlchemyEstimatorComponent): jasmine.Spy {
  return spyOn(component as any, 'createFinderWorker').and.throwError('Worker unavailable in component test.');
}

function finishSearch(): void {
  tick(120);
  flush();
}

describe('potion estimator', () => {
  it('keeps Alchemy guidance concise while retaining key assumptions', () => {
    const fixture = TestBed.createComponent(AlchemyEstimatorComponent);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Record up to four effects.');
    expect(text).toContain('Enter mixture power (%), not dose strength, to one decimal place.');
    expect(text).toContain('Exact matches contain only those effects');
    expect(text).toContain('Each selected effect must reach 1% in at least one product.');
    expect(text).not.toContain('The finder shows the best tested ratio for every matching herb combination');
    expect(text).not.toContain('Absolute duration is unavailable because base effect durations are not provided.');
    fixture.destroy();
  });

  it('calculates shared mixture powers and clean-water brew magnitudes from the worked example', () => {
    const result = estimatePotion(input());
    expect(result.errors).toEqual([]);
    const estimate = result.estimate!;
    expect(estimate.mixtureMassKg).toBe(1);
    expect(estimate.brewStrength).toBe(1);
    expect(estimate.productStrength).toBe(1);
    expect(estimate.effects.find(effect => effect.effectId === 'effect-3')?.mixturePower).toBe(0.601);
    expect(estimate.effects.find(effect => effect.effectId === 'effect-5')?.mixturePower).toBe(0.46);
    expect(estimate.effects.find(effect => effect.effectId === 'effect-3')?.magnitude).toBeCloseTo(0.3606, 4);
    expect(estimate.effects.find(effect => effect.effectId === 'effect-5')?.magnitude).toBeCloseTo(0.276, 4);
    expect(estimate.effects.find(effect => effect.effectId === 'effect-3')?.doseMagnitudeRange).toEqual({ min: 0.3606, max: 0.3606 });
    expect(estimate.toxicity).toEqual({ min: 0.5, max: 0.5 });
    expect(estimate.intoxication).toEqual({ min: 16, max: 16 });

    const diluted = estimatePotion(input({ ingredients: [
      { herbId: 'herb-1', amountKg: 0.1 }, { herbId: 'herb-2', amountKg: 0.1 }
    ] })).estimate!;
    expect(diluted.brewStrength).toBeCloseTo(0.8, 8);
    expect(diluted.toxicity).toEqual({ min: 0.5, max: 0.5 });
    expect(diluted.intoxication).toEqual({ min: 12.8, max: 12.8 });
  });

  it('reports uncertainty when Growth toxicity is unknown and scales a partial serving', () => {
    const result = estimatePotion(input({
      herbTables: tables(false),
      drinkVolumeLiters: 0.5
    }));
    const estimate = result.estimate!;
    expect(estimate.toxicity).toEqual({ min: 0.5, max: 0.75 });
    expect(estimate.intoxication).toEqual({ min: 8, max: 12 });
    expect(estimate.effects[0].doseMagnitude).toBeCloseTo(0.1803, 4);
    expect(estimate.warnings.join(' ')).toContain('unknown shared Growth effect');
    expect(doseEffectsForRecipe(estimate)).toEqual([
      { effectId: 'effect-3', strength: 0.18 },
      { effectId: 'effect-5', strength: 0.138 }
    ]);
  });

  it('accepts and preserves missing herb powers while disclosing the estimate-only midpoint assumption', () => {
    const unknownTables: HerbTableInput[] = [
      { herbId: 'herb-1', effects: [{ effectId: 'effect-3' }], effectsComplete: false },
      { herbId: 'herb-2', effects: [{ effectId: 'effect-3', power: 0.8 }], effectsComplete: false }
    ];
    const result = estimatePotion(input({ herbTables: unknownTables }));
    expect(result.errors).toEqual([]);
    expect(result.estimate!.effects[0].mixturePower).toBe(0.775);
    expect(result.estimate!.effects[0].mixturePowerRange).toEqual({ min: 0.65, max: 0.9 });
    expect(result.estimate!.effects[0].magnitudeRange).toEqual({ min: 0.39, max: 0.54 });
    expect(result.estimate!.warnings.join(' ')).toContain('assumes 0.75');

    const key = `${HERB_TABLE_STORAGE_KEY}.unknown-power-test`;
    localStorage.removeItem(key);
    try {
      const repository = new HerbTableRepository(localStorage, key);
      repository.save(unknownTables[0]);
      expect(repository.list()).toEqual([unknownTables[0]]);
      expect(JSON.parse(localStorage.getItem(key)!)[0].effects[0]).toEqual({ effectId: 'effect-3' });
    } finally {
      localStorage.removeItem(key);
    }
  });

  it('propagates unknown power bounds through effect sharing, rounding, servings, and distillate Growth intoxication', () => {
    const unknownPowerTables: HerbTableInput[] = [
      { herbId: 'herb-1', effects: [{ effectId: 'effect-3' }, { effectId: 'effect-5' }], effectsComplete: false },
      { herbId: 'herb-2', effects: [{ effectId: 'effect-3' }, { effectId: 'effect-5' }], effectsComplete: false }
    ];
    const multiEffect = estimatePotion(input({ herbTables: unknownPowerTables, drinkVolumeLiters: 0.5 })).estimate!;
    const rounded = multiEffect.effects.find(effect => effect.effectId === 'effect-3')!;
    expect(rounded.mixturePowerRange).toEqual({ min: 0.354, max: 0.707 });
    expect(rounded.doseMagnitudeRange.min).toBeCloseTo(0.1062, 8);
    expect(rounded.doseMagnitudeRange.max).toBeCloseTo(0.2121, 8);

    const growthTables: HerbTableInput[] = [
      { herbId: 'herb-1', effects: [{ effectId: 'effect-1' }], effectsComplete: false },
      { herbId: 'herb-2', effects: [{ effectId: 'effect-1' }], effectsComplete: false }
    ];
    const growthBrew = estimatePotion(input({ herbTables: growthTables, drinkVolumeLiters: 0.5 })).estimate!;
    expect(growthBrew.intoxication.min).toBeCloseTo(22.5, 8);
    expect(growthBrew.intoxication.max).toBeCloseTo(33, 8);

    const growthDistillate = estimatePotion(input({ herbTables: growthTables, product: 'distillate', liquidVolumeLiters: 4 })).estimate!;
    expect(growthDistillate.effects[0].magnitudeRange.min).toBeCloseTo(0.4, 8);
    expect(growthDistillate.effects[0].magnitudeRange.max).toBeCloseTo(0.8, 8);
    expect(growthDistillate.intoxication.min).toBeCloseTo(67.6, 8);
    expect(growthDistillate.intoxication.max).toBeCloseTo(95.6, 8);
  });

  it('adds the known Growth intoxication surcharge and estimates conventional distillation', () => {
    const growthTables: HerbTableInput[] = [
      { herbId: 'herb-1', effects: [{ effectId: 'effect-1', power: 0.8 }], effectsComplete: false },
      { herbId: 'herb-2', effects: [{ effectId: 'effect-1', power: 1 }], effectsComplete: false }
    ];
    const growth = estimatePotion(input({ herbTables: growthTables })).estimate!;
    expect(growth.effects[0].magnitude).toBeCloseTo(0.54, 4);
    expect(growth.intoxication.min).toBeCloseTo(61.8, 8);
    expect(growth.intoxication.max).toBeCloseTo(61.8, 8);

    const distillate = estimatePotion(input({
      herbTables: tables(),
      product: 'distillate',
      drinkVolumeLiters: 0.3
    })).estimate!;
    expect(distillate.productStrength).toBeCloseTo(4 / 3, 10);
    expect(distillate.availableVolumeLiters).toBe(0.3);
    expect(distillate.intoxication.min).toBeCloseTo(7.92, 8);
    expect(distillate.intoxication.max).toBeCloseTo(7.92, 8);
    expect(distillate.effects[0].magnitude).toBeCloseTo(0.4808, 4);
  });

  it('caps clean-water strength and rejects invalid mass, missing shared effects, and unavailable servings', () => {
    const saturated = estimatePotion(input({
      ingredients: [{ herbId: 'herb-1', amountKg: 0.5 }, { herbId: 'herb-2', amountKg: 0.5 }],
      liquidVolumeLiters: 0.25, drinkVolumeLiters: 0.25
    })).estimate!;
    expect(saturated.brewStrength).toBe(1);
    expect(saturated.effects[0].magnitude).toBeCloseTo(0.3606, 4);

    const tooMuch = estimatePotion(input({ ingredients: [
      { herbId: 'herb-1', amountKg: 0.6 }, { herbId: 'herb-2', amountKg: 0.5 }
    ] }));
    expect(tooMuch.estimate).toBeNull();
    expect(tooMuch.errors).toContain('Herb amounts must total at most 1 kg.');

    const noShared = estimatePotion(input({ herbTables: [
      { herbId: 'herb-1', effects: [{ effectId: 'effect-3', power: 0.9 }], effectsComplete: false },
      { herbId: 'herb-2', effects: [{ effectId: 'effect-5', power: 0.8 }], effectsComplete: false }
    ] }));
    expect(noShared.estimate).toBeNull();
    expect(noShared.errors[0]).toContain('two or more selected herb tables');

    const unavailable = estimatePotion(input({ product: 'distillate', drinkVolumeLiters: 0.4 }));
    expect(unavailable.estimate).toBeNull();
    expect(unavailable.errors).toContain('Drink volume cannot exceed the available product.');

    const overCapacity = estimatePotion(input({ product: 'distillate', liquidVolumeLiters: 10.1 }));
    expect(overCapacity.estimate).toBeNull();
    expect(overCapacity.errors).toContain('A conventional distillation charge cannot exceed the 10 L boiler capacity.');
  });

  it('validates and persists herb tables separately from recipes', () => {
    const key = `${HERB_TABLE_STORAGE_KEY}.test`;
    localStorage.removeItem(key);
    try {
      const repository = new HerbTableRepository(localStorage, key);
      const table = { herbId: 'herb-1', effects: [{ effectId: 'effect-3', power: 0.75 }], effectsComplete: false };
      repository.save(table);
      expect(new HerbTableRepository(localStorage, key).list()).toEqual([table]);

      const invalid = { ...table, effects: [{ effectId: 'effect-3', power: 0.49 }] };
      expect(() => repository.save(invalid)).toThrowError('Herb effect powers must be from 0.50 to 1.00 in 0.01 steps.');
      expect(repository.list()).toEqual([table]);

      localStorage.setItem(key, '{invalid');
      expect(() => repository.save(table)).toThrowError('Saved herb tables are not valid JSON.');
      expect(localStorage.getItem(key)).toBe('{invalid');
    } finally {
      localStorage.removeItem(key);
    }
  });
});

describe('AlchemyEstimatorComponent', () => {
  beforeEach(() => localStorage.removeItem(HERB_TABLE_STORAGE_KEY));
  beforeEach(() => localStorage.removeItem(HERB_EXPERIMENT_STORAGE_KEY));
  afterEach(() => localStorage.removeItem(HERB_TABLE_STORAGE_KEY));
  afterEach(() => localStorage.removeItem(HERB_EXPERIMENT_STORAGE_KEY));

  it('saves entered herb effects separately from recipe storage', fakeAsync(() => {
    const fixture = TestBed.createComponent(AlchemyEstimatorComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const effectInputs = [componentSelect('herb-1'), componentSelect('herb-2')];
    function componentSelect(herbId: string): HTMLSelectElement {
      const herbName = fixture.componentInstance.herbName(herbId);
      return host.querySelector(`select[aria-label="Known effect 1 for ${herbName}"]`)!;
    }
    effectInputs[0].value = 'effect-3';
    effectInputs[0].dispatchEvent(new Event('change', { bubbles: true }));
    effectInputs[1].value = 'effect-3';
    effectInputs[1].dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();

    expect(new HerbTableRepository().list()).toEqual([
      { herbId: 'herb-1', effects: [{ effectId: 'effect-3' }], effectsComplete: false, herbQuality: 50 },
      { herbId: 'herb-2', effects: [{ effectId: 'effect-3' }], effectsComplete: false, herbQuality: 50 }
    ]);
    fixture.destroy();
  }));

  it('searches saved herb tables and updates quality without repeating the search', fakeAsync(() => {
    new HerbTableRepository().save({
      herbId: 'herb-1',
      effects: [{ effectId: 'effect-3', power: 0.9 }],
      effectsComplete: false
    });
    new HerbTableRepository().save({
      herbId: 'herb-2',
      effects: [{ effectId: 'effect-3', power: 0.8 }],
      effectsComplete: false
    });
    const fixture = TestBed.createComponent(AlchemyEstimatorComponent);
    const component = fixture.componentInstance;
    const workerFactory = forceSearchFallback(component);
    component.toggleDesiredEffect('effect-3', true);
    expect(component.isSearching).toBeTrue();
    finishSearch();
    fixture.detectChanges();

    expect(component.candidates?.length).toBe(1);
    expect(fixture.nativeElement.querySelector('.candidate-grid')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.candidate-card').length).toBe(1);
    expect(fixture.nativeElement.querySelector('.candidate-card').querySelector('.candidate-ingredients')?.textContent).toContain(`${HERBS[0].name} — 0.01 kg`);
    expect(fixture.nativeElement.textContent).not.toContain('Candidate ');
    expect(fixture.nativeElement.textContent).not.toContain('1 kg mixture');
    expect(fixture.nativeElement.textContent).toContain('Herbal Brew (100%)');
    expect(fixture.nativeElement.textContent).toContain('Distillate (133%)');

    component.estimateQuality = true;
    component.invalidateResults();
    expect(component.candidates?.[0].quality).not.toBeNull();

    component.setMortarType('marble');
    component.setHerbQuality('herb-1', 88);
    expect(component.candidates?.[0].quality).not.toBeNull();
    expect(workerFactory.calls.count()).toBe(1);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.quality-results h4')?.textContent).toContain('Estimated quality and duration');
    component.toggleDesiredEffect('effect-2', true);
    finishSearch();
    expect(component.candidates).toEqual([]);
    fixture.destroy();
  }));

  it('expands exact potion results when the additional-effects option is selected', fakeAsync(() => {
    const fixture = TestBed.createComponent(AlchemyEstimatorComponent);
    const component = fixture.componentInstance;
    forceSearchFallback(component);
    component.herbTables = tables();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[aria-label="Include potions with additional effects"]')).toBeNull();
    component.toggleDesiredEffect('effect-3', true);
    finishSearch();
    fixture.detectChanges();

    expect(component.includeAdditionalEffects).toBeFalse();
    expect(component.candidates).toEqual([]);
    const includeExtras = fixture.nativeElement.querySelector(
      'input[aria-label="Include potions with additional effects"]'
    ) as HTMLInputElement;
    expect(includeExtras).not.toBeNull();
    includeExtras.checked = true;
    includeExtras.dispatchEvent(new Event('change', { bubbles: true }));
    finishSearch();
    fixture.detectChanges();

    expect(component.includeAdditionalEffects).toBeTrue();
    expect(component.candidates?.length).toBe(1);
    expect(component.candidates?.[0].effects.map(effect => effect.effectId)).toContain('effect-5');

    component.toggleDesiredEffect('effect-5', true);
    finishSearch();
    fixture.detectChanges();
    expect(component.includeAdditionalEffects).toBeFalse();
    expect(component.candidates?.length).toBe(1);
    expect(fixture.nativeElement.querySelector('input[aria-label="Include potions with additional effects"]')).toBeNull();
    fixture.destroy();
  }));

  it('resets expanded search when notebook effects change', fakeAsync(() => {
    const fixture = TestBed.createComponent(AlchemyEstimatorComponent);
    const component = fixture.componentInstance;
    forceSearchFallback(component);
    component.herbTables = tables();
    component.toggleDesiredEffect('effect-3', true);
    finishSearch();
    component.setIncludeAdditionalEffects(true);
    finishSearch();
    expect(component.includeAdditionalEffects).toBeTrue();
    expect(component.candidates?.length).toBe(1);

    component.removeEffect('herb-1', 1);
    finishSearch();
    fixture.detectChanges();

    expect(component.includeAdditionalEffects).toBeFalse();
    expect(component.candidates?.length).toBe(1);
    expect(fixture.nativeElement.querySelector('input[aria-label="Include potions with additional effects"]')).toBeNull();
    fixture.destroy();
  }));

  it('debounces input, discards an obsolete fallback search, and cancels on destruction', fakeAsync(() => {
    const fixture = TestBed.createComponent(AlchemyEstimatorComponent);
    const component = fixture.componentInstance;
    forceSearchFallback(component);
    component.herbTables = HERBS.slice(0, 5).map((herb, index) => ({
      herbId: herb.id,
      effects: [{ effectId: 'effect-3', power: 0.6 + index * 0.02 }],
      effectsComplete: false
    }));
    component.toggleDesiredEffect('effect-3', true);
    tick(120, { processNewMacroTasksSynchronously: false });
    expect(component.isSearching).toBeTrue();

    component.toggleDesiredEffect('effect-5', true);
    expect(component.candidates).toBeNull();
    finishSearch();
    expect(component.isSearching).toBeFalse();
    expect(component.candidates).toEqual([]);

    component.toggleDesiredEffect('effect-3', false);
    expect(component.isSearching).toBeTrue();
    fixture.destroy();
    tick(120);
    flush();
    expect(component.isSearching).toBeFalse();
  }));

  it('accepts worker results and falls back cooperatively when a worker errors', fakeAsync(() => {
    const fixture = TestBed.createComponent(AlchemyEstimatorComponent);
    const component = fixture.componentInstance;
    component.herbTables = tables();
    let responseHandler: ((event: MessageEvent) => void) | null = null;
    let errorHandler: ((event: ErrorEvent) => void) | null = null;
    let requestId = -1;
    const worker = {
      set onmessage(handler: ((event: MessageEvent) => void) | null) { responseHandler = handler; },
      get onmessage() { return responseHandler; },
      set onerror(handler: ((event: ErrorEvent) => void) | null) { errorHandler = handler; },
      get onerror() { return errorHandler; },
      postMessage: (request: { id: number }) => { requestId = request.id; },
      terminate: jasmine.createSpy('terminate')
    } as unknown as Worker;
    spyOn(component as any, 'createFinderWorker').and.returnValue(worker);
    component.toggleDesiredEffect('effect-3', true);
    tick(120);
    expect(component.isSearching).toBeTrue();
    responseHandler!(new MessageEvent('message', {
      data: { type: 'result', id: requestId, result: { errors: [], warnings: [], candidates: [] } }
    }));
    expect(component.isSearching).toBeFalse();
    expect(worker.terminate).toHaveBeenCalled();

    component.toggleDesiredEffect('effect-5', true);
    tick(120);
    const staleResponseHandler = responseHandler!;
    component.toggleDesiredEffect('effect-3', false);
    staleResponseHandler(new MessageEvent('message', {
      data: { type: 'result', id: requestId, result: { errors: [], warnings: [], candidates: [] } }
    }));
    expect(component.candidates).toBeNull();
    expect(worker.terminate).toHaveBeenCalledTimes(2);

    const fallbackFixture = TestBed.createComponent(AlchemyEstimatorComponent);
    const fallbackComponent = fallbackFixture.componentInstance;
    fallbackComponent.herbTables = tables();
    const failingWorker = {
      set onmessage(handler: ((event: MessageEvent) => void) | null) { responseHandler = handler; },
      get onmessage() { return responseHandler; },
      set onerror(handler: ((event: ErrorEvent) => void) | null) { errorHandler = handler; },
      get onerror() { return errorHandler; },
      postMessage: () => undefined,
      terminate: jasmine.createSpy('terminate')
    } as unknown as Worker;
    spyOn(fallbackComponent as any, 'createFinderWorker').and.returnValue(failingWorker);
    fallbackComponent.toggleDesiredEffect('effect-3', true);
    fallbackComponent.setIncludeAdditionalEffects(true);
    tick(120);
    errorHandler!(new ErrorEvent('error'));
    flush();
    expect(fallbackComponent.isSearching).toBeFalse();
    expect(fallbackComponent.candidates?.length).toBe(1);
    expect(failingWorker.terminate).toHaveBeenCalled();
    fixture.destroy();
    fallbackFixture.destroy();
  }));

  it('shows disclosure state through native details controls for herb effects and experiments', () => {
    const fixture = TestBed.createComponent(AlchemyEstimatorComponent);
    fixture.detectChanges();
    const sections = fixture.nativeElement.querySelectorAll('details.state-indicator') as NodeListOf<HTMLDetailsElement>;
    expect(sections.length).toBe(2);
    expect(Array.from(sections).every(section => !section.open)).toBeTrue();

    sections[0].querySelector('summary')!.click();
    sections[1].querySelector('summary')!.click();
    fixture.detectChanges();
    expect(Array.from(sections).every(section => section.open)).toBeTrue();

    sections[0].querySelector('summary')!.click();
    fixture.detectChanges();
    expect(sections[0].open).toBeFalse();
    expect(sections[1].open).toBeTrue();
    fixture.destroy();
  });

  it('uses fixed one-decimal experiment inputs and removes the precision selector', () => {
    const fixture = TestBed.createComponent(AlchemyEstimatorComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(Array.from(host.querySelectorAll('label')).some(label => label.textContent?.includes('Percentage decimal places'))).toBeFalse();
    expect(host.textContent).toContain('Enter mixture power (%), not dose strength, to one decimal place.');
    expect(Array.from(host.querySelectorAll('.experiment-row input')).every(input => (input as HTMLInputElement).step === '0.1')).toBeTrue();
    expect(component.experiment.displayPrecision).toBe(3);

    component.experiment = { ...component.experiment, displayPrecision: 6 };
    component.startNewExperiment();
    expect(component.experiment.displayPrecision).toBe(3);
    fixture.destroy();
  });

  it('preserves untouched legacy observations and requires corrected precision after edits', () => {
    const legacy = {
      dominantHerbId: 'herb-1',
      observations: [
        { effectId: 'effect-3', mixturePower: 0.809123 },
        { effectId: 'effect-5', mixturePower: 0.612345 }
      ],
      displayPrecision: 6,
      effectsComplete: true
    };
    localStorage.setItem(HERB_EXPERIMENT_STORAGE_KEY, JSON.stringify([legacy]));
    const fixture = TestBed.createComponent(AlchemyEstimatorComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.experiment.displayPrecision).toBe(6);
    expect(component.observedPower('effect-3')).toBe(80.9123);
    component.recordExperiment();
    expect(JSON.parse(localStorage.getItem(HERB_EXPERIMENT_STORAGE_KEY)!)[0]).toEqual(legacy);

    component.setEffectObservation('effect-3', 81.2);
    expect(component.experiment.displayPrecision).toBe(3);
    component.recordExperiment();
    expect(component.experimentErrors).toContain("Observed mixture powers must match the game's one-decimal percentage display.");
    expect(JSON.parse(localStorage.getItem(HERB_EXPERIMENT_STORAGE_KEY)!)[0]).toEqual(legacy);

    component.setEffectObservation('effect-5', 61.2);
    component.recordExperiment();
    expect(component.experimentErrors).toEqual([]);
    expect(JSON.parse(localStorage.getItem(HERB_EXPERIMENT_STORAGE_KEY)!)[0]).toEqual({
      ...legacy,
      observations: [
        { effectId: 'effect-3', mixturePower: 0.812 },
        { effectId: 'effect-5', mixturePower: 0.612 }
      ],
      displayPrecision: 3
    });
    fixture.destroy();
  });

  it('shows effect descriptions on visible names but not in dropdown options', fakeAsync(() => {
    const fixture = TestBed.createComponent(AlchemyEstimatorComponent);
    const component = fixture.componentInstance;
    forceSearchFallback(component);
    component.herbTables = tables();
    component.experimentEstimates = [
      { effectId: 'effect-3', minPower: 0.6, maxPower: 0.8, midpointPower: 0.7 },
      { effectId: 'effect-5', minPower: 0.5, maxPower: 0.7, midpointPower: 0.6 }
    ];
    component.toggleDesiredEffect('effect-3', true);
    component.setIncludeAdditionalEffects(true);
    finishSearch();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const effectName = (selector: string, name: string) => Array.from(host.querySelectorAll(selector))
      .find(element => element.textContent?.trim() === name) as HTMLElement | undefined;
    const desiredEffect = effectName('.effect-choices label span', 'Care')!;
    const experimentEffect = effectName('.experiment-result > span', 'Care')!;
    const desiredResult = effectName('.product-comparison tbody th[scope="row"]', 'Care')!;
    const additionalResult = effectName('.product-comparison tbody th[scope="row"]', 'Mana')!;
    const careDescription = component.effectDescription('effect-3')!;
    const manaDescription = component.effectDescription('effect-5')!;

    expect(desiredEffect.title).toBe(careDescription);
    expect(experimentEffect.title).toBe(careDescription);
    expect(desiredResult.title).toBe(careDescription);
    expect(additionalResult.title).toBe(manaDescription);
    expect(host.querySelector('.herb-table select option[value="effect-3"]')?.hasAttribute('title')).toBeFalse();
    expect(component.effectDescription('unknown-effect')).toBeNull();
    fixture.destroy();
  }));

  it('displays fixed effect fields in catalog and entry order', fakeAsync(() => {
    const fixture = TestBed.createComponent(AlchemyEstimatorComponent);
    const component = fixture.componentInstance;
    const herb = component.herbs[0];
    component.herbTables = [{
      herbId: herb.id,
      effects: [
        { effectId: 'effect-5', power: 0.6 },
        { effectId: 'effect-3', power: 0.8 }
      ],
      effectsComplete: false
    }];
    component.experiment = {
      dominantHerbId: herb.id,
      observations: [
        { effectId: 'effect-5', mixturePower: 0.55 },
        { effectId: 'effect-3', mixturePower: 0.65 }
      ],
      displayPrecision: 3,
      effectsComplete: false
    };
    component.experimentEstimates = [
      { effectId: 'effect-5', minPower: 0.5, maxPower: 0.7, midpointPower: 0.6 },
      { effectId: 'effect-3', minPower: 0.6, maxPower: 0.8, midpointPower: 0.7 }
    ] satisfies HerbPowerInference[];
    fixture.detectChanges();
    tick();
    fixture.detectChanges();

    expect(component.herbs.map(item => item.name)).toEqual([...component.herbs.map(item => item.name)].sort((a, b) => a.localeCompare(b)));
    expect(component.effects.map(item => item.id)).toEqual(EFFECTS.map(item => item.id));
    const herbSummaries = Array.from(fixture.nativeElement.querySelectorAll('.herb-table summary')) as HTMLElement[];
    expect(herbSummaries.map(summary => summary.firstChild?.textContent?.trim())).toEqual(component.herbs.map(item => item.name));

    const host = fixture.nativeElement as HTMLElement;
    const knownEffectSelects = Array.from(host.querySelectorAll(
      `select[aria-label^="Known effect"][aria-label$="for ${herb.name}"]`
    )) as HTMLSelectElement[];
    expect(knownEffectSelects.map(select => select.value)).toEqual(
      component.tableEffectsForDisplay(herb.id).map(row => row.effect.effectId)
    );
    expect(Array.from(knownEffectSelects[0].options).slice(1).map(option => option.textContent?.trim())).toEqual(
      component.effects.map(effect => effect.name)
    );
    expect(Array.from(host.querySelectorAll('.effect-choices label')).map(label => label.textContent?.trim()))
      .toEqual(component.effects.map(effect => effect.name));

    const observationInputs = Array.from(host.querySelectorAll('.experiment-row input')) as HTMLInputElement[];
    expect(observationInputs.length).toBe(EFFECTS.length);
    expect(observationInputs[2].value).toBe('65');
    expect(Array.from(host.querySelectorAll('.experiment-result > span')).map(label => label.textContent?.trim()))
      .toEqual(component.experimentEstimates.map(estimate => component.effectName(estimate.effectId)));
    expect(knownEffectSelects.length).toBe(4);
    component.setEffect(herb.id, 3, 'effect-13');
    expect(component.tableEffectsForDisplay(herb.id).map(row => row.effect.effectId)).toEqual(['effect-5', 'effect-3', '', 'effect-13']);
    component.setEffect(herb.id, 3, '');
    component.setEffectObservation('effect-3', 77);
    expect(component.observedPower('effect-3')).toBe(77);
    expect(component.experiment.observations.find(item => item.effectId === 'effect-3')?.mixturePower).toBe(0.77);
    component.setEffectObservation('effect-3', null);
    expect(component.observedPower('effect-3')).toBeNull();

    const displayedEffect = component.tableEffectsForDisplay(herb.id).find(row => row.effect.effectId === 'effect-5')!;
    expect(displayedEffect.index).toBe(0);
    const removedEffect = component.tableEffectsForDisplay(herb.id).find(row => row.effect.effectId === 'effect-3')!;
    component.removeEffect(herb.id, removedEffect.index);
    expect(component.tableFor(herb.id).effects.map(effect => effect.effectId)).toEqual(['effect-5']);
    fixture.destroy();
  }));

  it('compares both concentrations in one table and aligns effects by id', fakeAsync(() => {
    const fixture = TestBed.createComponent(AlchemyEstimatorComponent);
    const component = fixture.componentInstance;
    forceSearchFallback(component);
    component.herbTables = HERBS.slice(0, 2).map(herb => ({
      herbId: herb.id,
      effects: [{ effectId: 'effect-3' }, { effectId: 'effect-5' }, { effectId: 'effect-1' }],
      effectsComplete: false
    }));
    component.toggleDesiredEffect('effect-3', true);
    component.setIncludeAdditionalEffects(true);
    finishSearch();
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector('.candidate-card') as HTMLElement;
    const candidate = component.candidates![0];
    const displayedIngredients = Array.from(card.querySelectorAll('.candidate-ingredients span'))
      .map((ingredient: Element) => ingredient.textContent?.split(' — ')[0]);
    expect(displayedIngredients).toEqual([...candidate.ingredients]
      .sort((a, b) => component.herbName(a.herbId).localeCompare(component.herbName(b.herbId)))
      .map(ingredient => component.herbName(ingredient.herbId)));
    candidate.distillate.effects.reverse();
    fixture.detectChanges();

    const tables = card.querySelectorAll('.product-comparison');
    expect(tables.length).toBe(1);
    const table = tables[0];
    expect(table.textContent).toContain('Herbal Brew (100%)');
    expect(table.textContent).toContain('Distillate (133%)');
    expect(table.textContent).toContain('1.20 L available');
    expect(table.textContent).not.toContain('Product strength');
    expect(card.querySelectorAll('.product-estimates').length).toBe(0);

    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const effectRow = (effectId: string) => rows.find(row => row.querySelector('th')?.textContent?.trim() === component.effectName(effectId))!;
    const displayedEffects = [...candidate.effects].sort((a, b) =>
      Number(component.selectedEffectIds.includes(b.effectId)) - Number(component.selectedEffectIds.includes(a.effectId)) ||
      component.effectName(a.effectId).localeCompare(component.effectName(b.effectId))
    );
    expect(rows.filter(row => !row.classList.contains('intoxication-row')).map(row => row.querySelector('th')?.textContent?.trim()))
      .toEqual(displayedEffects.map(effect => component.effectName(effect.effectId)));
    for (const effectId of ['effect-3', 'effect-5']) {
      const row = effectRow(effectId);
      const cells = row.querySelectorAll('td');
      expect(cells[0].textContent!.trim()).toBe(component.formatEffectMagnitude(candidate.decoction, effectId));
      expect(cells[1].textContent!.trim()).toBe(component.formatEffectMagnitude(candidate.distillate, effectId));
      expect(cells[0].textContent).toContain('–');
      expect(row.classList.contains('desired-effect')).toBe(effectId === 'effect-3');
    }

    const intoxication = rows.find(row => row.classList.contains('intoxication-row'))!;
    expect(intoxication.querySelector('th')!.textContent).toContain('Intoxication');
    expect(intoxication.querySelectorAll('td')[0].textContent!.trim()).toBe(component.formatIntoxication(candidate.decoction.intoxication.min, candidate.decoction.intoxication.max));
    expect(intoxication.querySelectorAll('td')[0].textContent).toContain('–');
    expect(intoxication.querySelectorAll('td')[1].textContent!.trim()).toBe(component.formatIntoxication(candidate.distillate.intoxication.min, candidate.distillate.intoxication.max));

    component.toggleDesiredEffect('effect-5', true);
    component.setIncludeAdditionalEffects(true);
    finishSearch();
    fixture.detectChanges();
    const refreshedRows = Array.from(fixture.nativeElement.querySelectorAll('.candidate-card tbody tr')) as HTMLTableRowElement[];
    const refreshedEffects = refreshedRows.filter(row => !row.classList.contains('intoxication-row'));
    const desiredRows = refreshedEffects.filter(row => row.classList.contains('desired-effect'));
    expect(desiredRows.length).toBe(2);
    expect(desiredRows.map(row => row.querySelector('th')?.textContent?.trim())).toEqual(
      ['effect-3', 'effect-5'].sort((a, b) => component.effectName(a).localeCompare(component.effectName(b)))
        .map(effectId => component.effectName(effectId))
    );
    expect(refreshedEffects[0].classList.contains('desired-effect')).toBeTrue();
    fixture.destroy();
  }));

  it('renders every automatically found match and refreshes when effects change', fakeAsync(() => {
    const fixture = TestBed.createComponent(AlchemyEstimatorComponent);
    const component = fixture.componentInstance;
    forceSearchFallback(component);
    component.herbTables = HERBS.slice(0, 5).map((herb, index) => ({
      herbId: herb.id,
      effects: [{ effectId: 'effect-3', power: 0.6 + index * 0.1 }],
      effectsComplete: false
    }));
    component.toggleDesiredEffect('effect-3', true);
    finishSearch();
    fixture.detectChanges();

    expect(component.candidates!.length).toBe(26);
    expect(component.displayedCandidates.length).toBe(26);
    expect(fixture.nativeElement.querySelectorAll('.candidate-card').length).toBe(26);
    expect(fixture.nativeElement.querySelector('.result-pagination')).toBeNull();
    expect(fixture.nativeElement.querySelector('#results-title')?.textContent).toContain('26 matching combinations');
    expect(fixture.nativeElement.textContent).not.toContain('Candidate ');
    expect(fixture.nativeElement.querySelector('.candidate-ingredients')?.textContent).toContain('kg');

    component.toggleDesiredEffect('effect-2', true);
    finishSearch();
    fixture.detectChanges();
    expect(component.selectedEffectIds).toEqual(['effect-3', 'effect-2']);
    expect(component.candidates).toEqual([]);
    expect(fixture.nativeElement.querySelectorAll('.candidate-card').length).toBe(0);
    fixture.destroy();
  }));

  it('uses saved experiment estimates in the finder without storing herb powers', fakeAsync(() => {
    new HerbTableRepository().save({
      herbId: 'herb-2',
      effects: [{ effectId: 'effect-3', power: 0.8 }],
      effectsComplete: false
    });
    const fixture = TestBed.createComponent(AlchemyEstimatorComponent);
    const component = fixture.componentInstance;
    forceSearchFallback(component);
    component.setEffect('herb-1', 0, 'effect-3');
    component.toggleDesiredEffect('effect-3', true);
    finishSearch();
    component.setExperimentHerb('herb-1');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('I recorded the complete list of effects');
    component.recordExperiment();
    expect(component.experimentErrors).toContain('Record at least one observed effect.');
    component.setEffectObservation('effect-3', 80);
    component.recordExperiment();
    expect(component.experimentErrors).toEqual([]);
    const estimate = component.experimentEstimates.find(item => item.effectId === 'effect-3')!;
    finishSearch();
    expect(component.tableFor('herb-1').effects).toEqual([{ effectId: 'effect-3' }]);
    expect(component['tablesWithExperimentPowers']().find(table => table.herbId === 'herb-1')!.effects[0].power).toBe(estimate.midpointPower);
    expect(component.candidates?.length).toBeGreaterThan(0);
    expect(localStorage.getItem(HERB_EXPERIMENT_STORAGE_KEY)).toContain('effect-3');
    component.startNewExperiment();
    expect(component.experiment.effectsComplete).toBeTrue();
    fixture.destroy();
  }));
});