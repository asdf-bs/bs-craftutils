import { AlchemyRecipe, AlchemyRecipeRepository, EFFECTS, validateRecipe } from './alchemy';

function recipe(id: string, strength = 1): AlchemyRecipe {
  return {
    id,
    ingredients: [{ herbId: 'sage', amountKg: 0.29 }, { herbId: 'mint', amountKg: 0.71 }],
    effects: [{ effectId: 'healing', strength }],
  };
}

describe('alchemy recipes', () => {
  it('provides a description for every catalog effect', () => {
    expect(EFFECTS.length).toBe(13);
    expect(EFFECTS.every(effect => effect.description.trim().length > 0)).toBeTrue();
    expect(EFFECTS.find(effect => effect.name === 'Consciousness')?.description).toContain('not specified');
    expect(EFFECTS.find(effect => effect.name === 'Light step')?.description).toContain('not specified');
    expect(EFFECTS.find(effect => effect.name === 'Focus')?.description).toContain('not specified');
  });

  it('accepts positive hundredths up to a kilogram and rejects invalid amounts', () => {
    const item = recipe('one');
    expect(validateRecipe(item)).toEqual([]);
    item.ingredients[0].amountKg = 0.01;
    item.ingredients[1].amountKg = 0.01;
    expect(validateRecipe(item)).toEqual([]);
    item.ingredients[0].amountKg = 0.29;
    item.ingredients[1].amountKg = 0.70;
    expect(validateRecipe(item)).toEqual([]);
    item.ingredients[1].amountKg = 0.72;
    expect(validateRecipe(item)).toContain('Herb amounts must total at most 1 kg');
    item.ingredients[0].amountKg = 0.291;
    expect(validateRecipe(item)).toContain('Herb amounts must be positive multiples of 0.01 kg');
    item.ingredients[0].amountKg = 0;
    expect(validateRecipe(item)).toContain('Herb amounts must be positive multiples of 0.01 kg');
    item.ingredients[0].amountKg = -0.01;
    expect(validateRecipe(item)).toContain('Herb amounts must be positive multiples of 0.01 kg');
    item.ingredients[0].amountKg = Infinity;
    expect(validateRecipe(item)).toContain('Herb amounts must be positive multiples of 0.01 kg');
  });

  it('requires distinct herbs and effects with finite strength', () => {
    const item = recipe('one');
    item.ingredients[1].herbId = 'sage';
    item.effects[0].strength = NaN;
    expect(validateRecipe(item)).toContain('Duplicate herbs are not allowed');
    expect(validateRecipe(item)).toContain('At least two distinct herbs are required');
    expect(validateRecipe(item)).toContain('Effects require an id and a finite strength');
    item.ingredients.pop();
    item.effects = [];
    expect(validateRecipe(item)).toContain('At least two distinct herbs are required');
    expect(validateRecipe(item)).toContain('At least one effect is required');
  });

  it('persists, updates, deletes and searches by descending effect strength', () => {
    const key = 'alchemy.test.recipes';
    localStorage.removeItem(key);
    try {
      const repo = new AlchemyRecipeRepository(localStorage, key);
      repo.save(recipe('weak', 2));
      repo.save(recipe('strong', 8));
      const other = recipe('other');
      other.effects = [{ effectId: 'focus', strength: 100 }];
      repo.save(other);
      const reloaded = new AlchemyRecipeRepository(localStorage, key);
      expect(reloaded.search('healing').map(item => item.id)).toEqual(['strong', 'weak']);
      reloaded.save(recipe('weak', 10));
      expect(repo.search('healing').map(item => item.id)).toEqual(['weak', 'strong']);
      const smaller = recipe('weak', 10);
      smaller.ingredients[0].amountKg = 0.01;
      reloaded.save(smaller);
      expect(repo.list().find(item => item.id === 'weak')).toEqual(smaller);
      repo.delete('weak');
      expect(reloaded.list().map(item => item.id)).toEqual(['strong', 'other']);
      const invalid = recipe('invalid');
      invalid.ingredients[0].amountKg = 0.3;
      expect(() => repo.save(invalid)).toThrow();
      expect(repo.list().length).toBe(2);
    } finally {
      localStorage.removeItem(key);
    }
  });
});