import { Component, ElementRef, HostListener, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlchemyRecipe, AlchemyRecipeRepository, EFFECTS, HERBS, RecipeEffect, RecipeIngredient } from './alchemy/alchemy';

type Theme = 'light' | 'dark' | 'system';
const THEME_STORAGE_KEY = 'craftkeeper.theme';

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  @ViewChild('effectDropdown') private effectDropdown?: ElementRef<HTMLDetailsElement>;
  @ViewChild('addRecipeButton') private addRecipeButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('workspace') private workspace?: ElementRef<HTMLElement>;
  @ViewChild('ingredientFilterControl') private ingredientFilterControl?: ElementRef<HTMLSelectElement>;
  private dialogElement?: HTMLElement;
  @ViewChild('recipeDialog') set recipeDialog(dialog: ElementRef<HTMLElement> | undefined) {
    this.dialogElement = dialog?.nativeElement;
    dialog?.nativeElement.querySelector<HTMLElement>('button')?.focus();
  }
  readonly herbs = HERBS;
  readonly effects = EFFECTS;
  private readonly repository = new AlchemyRecipeRepository();
  recipes: AlchemyRecipe[] = [];
  ingredientFilter = '';
  effectFilters: string[] = [];
  formOpen = false;
  editingId: string | null = null;
  private formOpener?: HTMLElement;
  theme: Theme = 'system';
  draftIngredients: RecipeIngredient[] = [];
  draftEffects: RecipeEffect[] = [];
  formError = '';
  journalError = '';

  constructor() {
    try { this.recipes = this.repository.list(); }
    catch { this.journalError = 'Unable to read saved recipes from this browser.'; }
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark' || saved === 'system') this.theme = saved;
    } catch { /* The journal remains usable when preference storage is unavailable. */ }
  }

  get filteredRecipes(): AlchemyRecipe[] {
    const filtered = this.recipes.filter(recipe =>
      (!this.ingredientFilter || recipe.ingredients.some(item => item.herbId === this.ingredientFilter)) &&
      this.effectFilters.every(id => recipe.effects.some(item => item.effectId === id))
    );
    if (this.effectFilters.length) {
      const selected = this.effects.filter(effect => this.effectFilters.includes(effect.id));
      filtered.sort((a, b) => {
        for (const effect of selected) {
          const difference = b.effects.find(item => item.effectId === effect.id)!.strength -
            a.effects.find(item => item.effectId === effect.id)!.strength;
          if (difference) return difference;
        }
        return 0;
      });
    }
    return filtered;
  }

  get totalAmount(): number {
    return this.draftIngredients.reduce((sum, item) => sum + (Number(item.amountKg) || 0), 0);
  }

  recipeTotal(recipe: AlchemyRecipe): number {
    return recipe.ingredients.reduce((sum, item) => sum + item.amountKg, 0);
  }

  openForm(recipe?: AlchemyRecipe, opener?: HTMLElement): void {
    this.editingId = recipe?.id ?? null;
    this.formOpener = opener;
    this.draftIngredients = recipe ? recipe.ingredients.map(item => ({ ...item })) : [{ herbId: '', amountKg: 0.5 }, { herbId: '', amountKg: 0.5 }];
    this.draftEffects = recipe ? recipe.effects.map(item => ({ ...item })) : [{ effectId: '', strength: null as unknown as number }];
    this.formError = '';
    this.formOpen = true;
  }
  closeForm(): void {
    this.formOpen = false;
    this.workspace?.nativeElement.removeAttribute('inert');
    if (this.formOpener?.isConnected && this.filteredRecipes.some(recipe => recipe.id === this.editingId)) this.formOpener.focus();
    else this.addRecipeButton?.nativeElement.focus();
  }
  handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); this.closeForm(); return; }
    if (event.key !== 'Tab') return;
    const dialog = event.currentTarget as HTMLElement;
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'));
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  addIngredient(): void { this.draftIngredients.push({ herbId: '', amountKg: 0.5 }); }
  removeIngredient(index: number): void { this.dialogElement?.querySelector<HTMLButtonElement>('.close-button')?.focus(); this.draftIngredients.splice(index, 1); }
  addEffect(): void { this.draftEffects.push({ effectId: '', strength: null as unknown as number }); }
  removeEffect(index: number): void { this.dialogElement?.querySelector<HTMLButtonElement>('.close-button')?.focus(); this.draftEffects.splice(index, 1); }
  removeEffectFilter(id: string): void {
    this.effectDropdown?.nativeElement.querySelector<HTMLElement>('summary')?.focus();
    this.toggleEffectFilter(id, false);
  }
  toggleEffectFilter(id: string, checked: boolean): void {
    this.effectFilters = checked ? [...this.effectFilters, id] : this.effectFilters.filter(item => item !== id);
  }
  @HostListener('document:click', ['$event'])
  closeEffectDropdownOnOutsideClick(event: MouseEvent): void {
    const dropdown = this.effectDropdown?.nativeElement;
    if (dropdown && event.target instanceof Node && !dropdown.contains(event.target)) dropdown.open = false;
  }
  closeEffectDropdownOnEscape(event: KeyboardEvent): void {
    const dropdown = this.effectDropdown?.nativeElement;
    if (event.key === 'Escape' && dropdown?.open) {
      event.preventDefault();
      dropdown.open = false;
      dropdown.querySelector<HTMLElement>('summary')?.focus();
    }
  }
  clearFilters(): void { this.ingredientFilter = ''; this.effectFilters = []; }
  clearFiltersFromButton(): void { this.ingredientFilterControl?.nativeElement.focus(); this.clearFilters(); }
  herbName(id: string): string { return this.herbs.find(item => item.id === id)?.name ?? id; }
  effectName(id: string): string { return this.effects.find(item => item.id === id)?.name ?? id; }

  setTheme(theme: Theme): void {
    this.theme = theme;
    try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* Keep the current selection for this session. */ }
  }

  resetJournal(): void {
    if (!confirm('Reset the journal? This permanently deletes all saved recipes.')) return;
    try { this.repository.reset(); this.recipes = []; this.clearFilters(); }
    catch { alert('Unable to reset the journal in this browser.'); }
  }

  exportRecipes(): void {
    const url = URL.createObjectURL(new Blob([JSON.stringify(this.recipes, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'alchemy-recipes.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  async importRecipes(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const count = this.repository.importRecipes(JSON.parse(await file.text()));
      this.recipes = this.repository.list();
      alert(`Imported ${count} recipes. Existing recipe IDs were skipped.`);
    } catch {
      alert('Unable to import recipes. Please choose a valid recipe export.');
    } finally {
      input.value = '';
    }
  }

  saveRecipe(): void {
    const recipe: AlchemyRecipe = {
      id: this.editingId ?? (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`),
      ingredients: this.draftIngredients, effects: this.draftEffects
    };
    try {
      this.repository.save(recipe);
      this.recipes = this.repository.list();
      this.closeForm();
    } catch (error) {
      this.formError = error instanceof Error ? error.message : 'Unable to save recipe.';
    }
  }

  deleteRecipe(id: string): void {
    if (!confirm('Delete this recipe?')) return;
    try { this.repository.delete(id); this.recipes = this.repository.list(); this.addRecipeButton?.nativeElement.focus(); }
    catch { alert('Unable to delete recipe from this browser.'); }
  }
}