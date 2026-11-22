import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { ALCHEMY_STORAGE_KEY, AlchemyRecipeRepository } from './alchemy/alchemy';

describe('AppComponent', () => {
  beforeEach(async () => {
    localStorage.removeItem(ALCHEMY_STORAGE_KEY);
    localStorage.removeItem('craftkeeper.theme');
    await TestBed.configureTestingModule({ imports: [AppComponent] }).compileComponents();
  });
  afterEach(() => { localStorage.removeItem(ALCHEMY_STORAGE_KEY); localStorage.removeItem('craftkeeper.theme'); });

  it('renders the journal and all placeholder choices', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.nav-item.active').textContent).toContain('Alchemy');
    expect(fixture.componentInstance.herbs.length).toBe(12);
    expect(fixture.componentInstance.effects.length).toBe(12);
  });

  it('defaults new ingredient amounts to 0.5 kg', () => {
    const app = TestBed.createComponent(AppComponent).componentInstance;
    app.openForm();
    expect(app.draftIngredients.map(item => item.amountKg)).toEqual([0.5, 0.5]);
    app.addIngredient();
    expect(app.draftIngredients[2].amountKg).toBe(0.5);
  });

  it('edits a recipe without mutating it on cancel or duplicating it on save', () => {
    const recipe = { id: 'one', ingredients: [{ herbId: 'herb-1', amountKg: 0.3 }, { herbId: 'herb-2', amountKg: 0.4 }], effects: [{ effectId: 'effect-1', strength: 1 }] };
    const repository = new AlchemyRecipeRepository();
    repository.save(recipe);
    const fixture = TestBed.createComponent(AppComponent);
    document.body.appendChild(fixture.nativeElement);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    const edit: HTMLButtonElement = fixture.nativeElement.querySelector('[aria-label^="Edit recipe"]');
    edit.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#form-title').textContent).toContain('Edit recipe');
    expect(app.draftIngredients[0].amountKg).toBe(0.3);
    app.draftIngredients[0].amountKg = 0.2;
    app.draftEffects[0].strength = 5;
    app.closeForm();
    expect(document.activeElement).toBe(edit);
    expect(app.recipes[0]).toEqual(recipe);
    expect(repository.list()).toEqual([recipe]);
    fixture.detectChanges();
    edit.click();
    app.draftIngredients[0].amountKg = 0.2;
    app.draftEffects[0].strength = 5;
    app.saveRecipe();
    expect(repository.list().length).toBe(1);
    expect(repository.list()[0].id).toBe('one');
    expect(repository.list()[0].ingredients[0].amountKg).toBe(0.2);
    expect(repository.list()[0].effects[0].strength).toBe(5);
    fixture.destroy();
    fixture.nativeElement.remove();
  });

  it('keeps card editing keyboard accessible and deletion separate', () => {
    const repository = new AlchemyRecipeRepository();
    repository.save({ id: 'one', ingredients: [{ herbId: 'herb-1', amountKg: 0.5 }, { herbId: 'herb-2', amountKg: 0.5 }], effects: [{ effectId: 'effect-1', strength: 1 }] });
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const edit: HTMLButtonElement = fixture.nativeElement.querySelector('.recipe-card-edit');
    expect(edit.type).toBe('button');
    expect(edit.getAttribute('aria-label')).toContain('Edit recipe');
    spyOn(window, 'confirm').and.returnValue(false);
    fixture.nativeElement.querySelector('.delete-button').click();
    expect(fixture.componentInstance.formOpen).toBeFalse();
    expect(repository.list().length).toBe(1);
  });

  it('keeps the add recipe card first and opens the form in empty and filtered journals', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    const grid: HTMLElement = fixture.nativeElement.querySelector('.recipe-grid');
    const addCard = grid.querySelector<HTMLButtonElement>('.add-recipe-card')!;
    expect(grid.firstElementChild).toBe(addCard);
    addCard.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).not.toBeNull();
    app.closeForm();
    app.recipes = [{ id: 'one', ingredients: [{ herbId: 'herb-1', amountKg: 0.5 }, { herbId: 'herb-2', amountKg: 0.5 }], effects: [{ effectId: 'effect-1', strength: 1 }] }];
    fixture.detectChanges();
    expect(grid.firstElementChild).toBe(addCard);
    expect(grid.querySelector('.recipe-card')).not.toBeNull();
    app.ingredientFilter = 'herb-3';
    fixture.detectChanges();
    expect(grid.firstElementChild).toBe(addCard);
    expect(fixture.nativeElement.textContent).toContain('No recipes found');
    addCard.click();
    expect(app.formOpen).toBeTrue();
  });

  it('manages dialog focus and provides distinct form labels', () => {
    const fixture = TestBed.createComponent(AppComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    const addCard: HTMLButtonElement = fixture.nativeElement.querySelector('.add-recipe-card');
    addCard.click();
    fixture.detectChanges();
    const dialog: HTMLElement = fixture.nativeElement.querySelector('[role="dialog"]');
    const close = dialog.querySelector<HTMLButtonElement>('.close-button')!;
    const save = dialog.querySelector<HTMLButtonElement>('[type="submit"]')!;
    expect(document.activeElement).toBe(close);
    expect(fixture.nativeElement.querySelector('.workspace').hasAttribute('inert')).toBeTrue();
    expect(dialog.querySelector('[aria-label="Herb 2"]')).not.toBeNull();
    close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(save);
    save.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(close);
    close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(addCard);
    fixture.destroy();
    fixture.nativeElement.remove();
  });

  it('announces storage read errors outside the dialog', () => {
    localStorage.setItem(ALCHEMY_STORAGE_KEY, '{');
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('Unable to read');
  });

  it('associates save errors with the form controls', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.componentInstance.openForm();
    fixture.detectChanges();
    fixture.componentInstance.saveRecipe();
    fixture.detectChanges();
    const error: HTMLElement = fixture.nativeElement.querySelector('.form-error');
    const herb: HTMLElement = fixture.nativeElement.querySelector('[aria-label="Herb 1"]');
    expect(error.id).toBeTruthy();
    expect(herb.getAttribute('aria-describedby')).toContain(error.id);
  });

  it('closes the effect filter with Escape and returns focus to its summary', () => {
    const fixture = TestBed.createComponent(AppComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    const details: HTMLDetailsElement = fixture.nativeElement.querySelector('details');
    details.open = true;
    const checkbox = details.querySelector('input')!;
    checkbox.focus();
    checkbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(details.open).toBeFalse();
    expect(document.activeElement).toBe(details.querySelector('summary'));
    fixture.destroy();
    fixture.nativeElement.remove();
  });

  it('returns focus to the add card after deleting a focused recipe', () => {
    const fixture = TestBed.createComponent(AppComponent);
    document.body.appendChild(fixture.nativeElement);
    const recipe = { id: 'one', ingredients: [{ herbId: 'herb-1', amountKg: 0.5 }, { herbId: 'herb-2', amountKg: 0.5 }], effects: [{ effectId: 'effect-1', strength: 1 }] };
    new AlchemyRecipeRepository().save(recipe);
    fixture.componentInstance.recipes = [recipe];
    fixture.detectChanges();
    spyOn(window, 'confirm').and.returnValue(true);
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.delete-button');
    button.focus();
    button.click();
    fixture.detectChanges();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.add-recipe-card'));
    fixture.destroy();
    fixture.nativeElement.remove();
  });

  it('keeps focus in the interface when removing rows and filters', () => {
    const fixture = TestBed.createComponent(AppComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.add-recipe-card').click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[aria-label="Remove ingredient 1"]').click();
    fixture.detectChanges();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.close-button'));
    fixture.nativeElement.querySelector('[aria-label="Remove effect 1"]').click();
    fixture.detectChanges();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.close-button'));
    fixture.componentInstance.closeForm();
    fixture.componentInstance.toggleEffectFilter('effect-1', true);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[aria-label="Remove Growth filter"]').click();
    fixture.detectChanges();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('summary'));
    fixture.componentInstance.ingredientFilter = 'herb-1';
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.clear-filter').click();
    fixture.detectChanges();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.filters select'));
    fixture.destroy();
    fixture.nativeElement.remove();
  });

  it('saves recipes and filters by ingredient and descending effect strength', () => {
    const app = TestBed.createComponent(AppComponent).componentInstance;
    for (const strength of [2, 8]) {
      app.openForm();
      app.draftIngredients = [{ herbId: 'herb-1', amountKg: 0.01 }, { herbId: 'herb-2', amountKg: 0.99 }];
      app.draftEffects = [{ effectId: 'effect-1', strength }];
      app.saveRecipe();
    }
    const reloaded = TestBed.createComponent(AppComponent).componentInstance;
    reloaded.ingredientFilter = 'herb-1';
    reloaded.effectFilters = ['effect-1'];
    expect(reloaded.filteredRecipes.map(recipe => recipe.effects[0].strength)).toEqual([8, 2]);
    reloaded.ingredientFilter = 'herb-3';
    expect(reloaded.filteredRecipes.length).toBe(0);
  });

  it('filters for all selected effects and sorts by their strength in catalog order', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    const ingredients = [{ herbId: 'herb-1', amountKg: 0.5 }, { herbId: 'herb-2', amountKg: 0.5 }];
    app.recipes = [
      { id: 'a', ingredients, effects: [{ effectId: 'effect-1', strength: 2 }, { effectId: 'effect-2', strength: 9 }] },
      { id: 'b', ingredients, effects: [{ effectId: 'effect-1', strength: 3 }, { effectId: 'effect-2', strength: 1 }] },
      { id: 'c', ingredients, effects: [{ effectId: 'effect-1', strength: 3 }, { effectId: 'effect-2', strength: 5 }] },
      { id: 'd', ingredients, effects: [{ effectId: 'effect-1', strength: 10 }] },
    ];
    fixture.detectChanges();
    const boxes: NodeListOf<HTMLInputElement> = fixture.nativeElement.querySelectorAll('.effect-options input');
    boxes[1].click();
    boxes[0].click();
    fixture.detectChanges();
    expect(app.filteredRecipes.map(recipe => recipe.id)).toEqual(['c', 'b', 'a']);
    expect(fixture.nativeElement.querySelector('.effect-filter summary').textContent).toContain('2 selected');
    expect(fixture.nativeElement.querySelector('.selected-effects').textContent).toContain('Growth');
    fixture.nativeElement.querySelector('[aria-label="Remove Growth filter"]').click();
    fixture.detectChanges();
    expect(app.effectFilters).toEqual(['effect-2']);
    expect(boxes[0].checked).toBeFalse();
    app.ingredientFilter = 'herb-3';
    expect(app.filteredRecipes.length).toBe(0);
    fixture.nativeElement.querySelector('.clear-filter').click();
    fixture.detectChanges();
    expect(app.effectFilters).toEqual([]);
    expect(app.ingredientFilter).toBe('');
    expect(boxes[0].checked).toBeFalse();
    expect(app.filteredRecipes.length).toBe(4);
  });

  it('closes the effect dropdown on outside clicks but keeps it open while selecting effects', () => {
    const fixture = TestBed.createComponent(AppComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    const details: HTMLDetailsElement = fixture.nativeElement.querySelector('.effect-filter details');
    const checkbox: HTMLInputElement = details.querySelector('input')!;
    details.open = true;
    checkbox.click();
    fixture.detectChanges();
    expect(details.open).toBeTrue();
    expect(fixture.componentInstance.effectFilters).toEqual(['effect-1']);
    document.body.click();
    expect(details.open).toBeFalse();
    expect(fixture.componentInstance.effectFilters).toEqual(['effect-1']);
    fixture.destroy();
    fixture.nativeElement.remove();
  });

  it('imports valid recipes atomically, skips existing IDs, and displays partial totals', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    const recipe = { id: 'one', ingredients: [{ herbId: 'herb-1', amountKg: 0.1 }, { herbId: 'herb-2', amountKg: 0.2 }], effects: [{ effectId: 'effect-1', strength: 3 }] };
    const repository = new AlchemyRecipeRepository();
    expect(repository.importRecipes([recipe, recipe])).toBe(1);
    expect(repository.importRecipes([recipe])).toBe(0);
    expect(() => repository.importRecipes([{ ...recipe, id: 'two' }, { ...recipe, id: 'bad', ingredients: [null] }])).toThrow();
    expect(repository.list().length).toBe(1);
    app.recipes = repository.list();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.card-label').textContent).toContain('0.30 KG TOTAL');
  });

  it('does not save duplicate herbs', () => {
    const app = TestBed.createComponent(AppComponent).componentInstance;
    app.openForm();
    app.draftIngredients = [{ herbId: 'herb-1', amountKg: 0.5 }, { herbId: 'herb-1', amountKg: 0.5 }];
    app.draftEffects = [{ effectId: 'effect-1', strength: 1 }];
    app.saveRecipe();
    expect(app.formError).toContain('Duplicate herbs');
    expect(app.recipes.length).toBe(0);
  });

  it('retains existing named recipes and resets only after confirmation', () => {
    localStorage.setItem(ALCHEMY_STORAGE_KEY, JSON.stringify([{ id: 'old', name: 'Old potion', ingredients: [{ herbId: 'herb-1', amountKg: 0.5 }, { herbId: 'herb-2', amountKg: 0.5 }], effects: [{ effectId: 'effect-1', strength: 3 }] }]));
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Old potion');
    expect(app.recipes.length).toBe(1);
    app.setTheme('dark');
    app.ingredientFilter = 'herb-1';
    const confirmation = spyOn(window, 'confirm').and.returnValue(false);
    app.resetJournal();
    expect(app.recipes.length).toBe(1);
    confirmation.and.returnValue(true);
    app.resetJournal();
    expect(app.recipes.length).toBe(0);
    expect(app.ingredientFilter).toBe('');
    expect(localStorage.getItem(ALCHEMY_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('craftkeeper.theme')).toBe('dark');
  });

  it('persists theme choices and defaults invalid values to system', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance.theme).toBe('system');
    fixture.componentInstance.setTheme('light');
    expect(TestBed.createComponent(AppComponent).componentInstance.theme).toBe('light');
    fixture.componentInstance.setTheme('dark');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.app-shell').getAttribute('data-theme')).toBe('dark');
    localStorage.setItem('craftkeeper.theme', 'invalid');
    expect(TestBed.createComponent(AppComponent).componentInstance.theme).toBe('system');
  });

  it('switches themes directly from the sidebar and marks the selected button', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('header')).toBeNull();
    expect(fixture.nativeElement.querySelector('footer')).toBeNull();
    const buttons: NodeListOf<HTMLButtonElement> = fixture.nativeElement.querySelectorAll('.sidebar .theme-picker button');
    expect(buttons.length).toBe(3);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    buttons[2].click();
    fixture.detectChanges();
    expect(buttons[2].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[0].getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem('craftkeeper.theme')).toBe('dark');
    buttons[1].click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.app-shell').getAttribute('data-theme')).toBe('light');
  });
});