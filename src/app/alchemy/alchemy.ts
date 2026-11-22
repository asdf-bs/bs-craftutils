export interface Herb {
  id: string;
  name: string;
}

export interface Effect {
  id: string;
  name: string;
}

export interface RecipeIngredient {
  herbId: string;
  amountKg: number;
}

export interface RecipeEffect {
  effectId: string;
  strength: number;
}

export interface AlchemyRecipe {
  id: string;
  ingredients: RecipeIngredient[];
  effects: RecipeEffect[];
}

export const HERBS: readonly Herb[] = [
  'Bog arum', 'Bogbean', 'Cattail', 'Cottongrass', 'Marsh Cinqefoil', 'Marsh Marigold',
  'Marsh Tea', 'Meadowsweet', 'Sphagnum', 'Sundew', 'Sweetflag', 'Watermint',
].map((name, index) => ({ id: `herb-${index + 1}`, name }));

export const EFFECTS: readonly Effect[] = [
  'Growth', 'Shrink', 'Care', 'Stamina', 'Mana', 'Tough hide',
  'Rage', 'Consciousness', 'Stretch', 'Protein', 'Light step', 'Focus',
].map((name, index) => ({ id: `effect-${index + 1}`, name }));

export function validateRecipe(recipe: AlchemyRecipe): string[] {
  const errors: string[] = [];
  if (!recipe.id?.trim()) errors.push('Recipe id is required');

  const ingredients = recipe.ingredients;
  if (!Array.isArray(ingredients) || ingredients.length < 2) {
    errors.push('At least two distinct herbs are required');
  }
  if (Array.isArray(ingredients)) {
    const ids = ingredients.map(ingredient => ingredient.herbId?.trim());
    if (ids.some(id => !id)) errors.push('Herb id is required');
    if (new Set(ids).size !== ids.length) errors.push('Duplicate herbs are not allowed');
    if (new Set(ids.filter(Boolean)).size < 2 && ingredients.length >= 2) {
      errors.push('At least two distinct herbs are required');
    }
    const units = ingredients.map(ingredient => ingredient.amountKg * 100);
    if (units.some(value => !Number.isFinite(value) || value <= 0 || Math.abs(value - Math.round(value)) > 1e-8)) {
      errors.push('Herb amounts must be positive multiples of 0.01 kg');
    } else if (units.reduce((total, value) => total + Math.round(value), 0) > 100) {
      errors.push('Herb amounts must total at most 1 kg');
    }
  }

  if (!Array.isArray(recipe.effects) || recipe.effects.length === 0) {
    errors.push('At least one effect is required');
  } else {
    if (recipe.effects.some(effect => !effect.effectId?.trim() || !Number.isFinite(effect.strength))) {
      errors.push('Effects require an id and a finite strength');
    }
    const ids = recipe.effects.map(effect => effect.effectId?.trim());
    if (new Set(ids).size !== ids.length) errors.push('Duplicate effects are not allowed');
  }
  return errors;
}

export const ALCHEMY_STORAGE_KEY = 'alchemy.recipes';

export class AlchemyRecipeRepository {
  constructor(
    private readonly storage: Storage = localStorage,
    private readonly key: string = ALCHEMY_STORAGE_KEY,
  ) {}

  list(): AlchemyRecipe[] {
    const value = this.storage.getItem(this.key);
    if (value === null) return [];
    const recipes: unknown = JSON.parse(value);
    if (!Array.isArray(recipes)) throw new Error('Invalid stored recipes');
    return recipes as AlchemyRecipe[];
  }

  save(recipe: AlchemyRecipe): void {
    const errors = validateRecipe(recipe);
    if (errors.length) throw new Error(errors.join('; '));
    const recipes = this.list();
    const index = recipes.findIndex(item => item.id === recipe.id);
    if (index === -1) recipes.push(recipe);
    else recipes[index] = recipe;
    this.storage.setItem(this.key, JSON.stringify(recipes));
  }

  importRecipes(data: unknown): number {
    if (!Array.isArray(data)) throw new Error('Expected an array of recipes.');
    for (const recipe of data) {
      if (!recipe || typeof recipe !== 'object' || typeof recipe.id !== 'string' ||
          !Array.isArray(recipe.ingredients) || !Array.isArray(recipe.effects) ||
          recipe.ingredients.some((item: any) => !item || typeof item.herbId !== 'string' ||
            !HERBS.some(herb => herb.id === item.herbId) || typeof item.amountKg !== 'number') ||
          recipe.effects.some((item: any) => !item || typeof item.effectId !== 'string' ||
            !EFFECTS.some(effect => effect.id === item.effectId) || typeof item.strength !== 'number') ||
          validateRecipe(recipe).length) {
        throw new Error('The file contains an invalid recipe.');
      }
    }
    const recipes = this.list();
    const ids = new Set(recipes.map(recipe => recipe.id));
    let added = 0;
    for (const recipe of data as AlchemyRecipe[]) {
      if (!ids.has(recipe.id)) {
        recipes.push(recipe);
        ids.add(recipe.id);
        added++;
      }
    }
    if (added) this.storage.setItem(this.key, JSON.stringify(recipes));
    return added;
  }

  delete(id: string): void {
    this.storage.setItem(this.key, JSON.stringify(this.list().filter(recipe => recipe.id !== id)));
  }

  reset(): void {
    this.storage.removeItem(this.key);
  }

  search(effectId: string): AlchemyRecipe[] {
    return this.list()
      .filter(recipe => recipe.effects.some(effect => effect.effectId === effectId))
      .sort((a, b) => b.effects.find(effect => effect.effectId === effectId)!.strength -
        a.effects.find(effect => effect.effectId === effectId)!.strength);
  }
}