import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AppComponent } from './app.component';
import { routes } from './app.routes';
import { ALCHEMY_STORAGE_KEY } from './alchemy/alchemy';
import { HERB_TABLE_STORAGE_KEY } from './alchemy/estimator';
import { HERB_EXPERIMENT_STORAGE_KEY } from './alchemy/experiment';
import { RESOURCE_STORAGE_KEY } from './resources/resources';

async function createAppFixture(url = '/'): Promise<ComponentFixture<AppComponent>> {
  const fixture = TestBed.createComponent(AppComponent);
  fixture.detectChanges();
  await TestBed.inject(Router).navigateByUrl(url);
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('AppComponent', () => {
  beforeEach(async () => {
    localStorage.removeItem(ALCHEMY_STORAGE_KEY);
    localStorage.removeItem(HERB_TABLE_STORAGE_KEY);
    localStorage.removeItem(HERB_EXPERIMENT_STORAGE_KEY);
    localStorage.removeItem(RESOURCE_STORAGE_KEY);
    localStorage.removeItem('craftkeeper.theme');
    await TestBed.configureTestingModule({ imports: [AppComponent], providers: [provideRouter(routes)] }).compileComponents();
  });

  afterEach(() => {
    localStorage.removeItem(ALCHEMY_STORAGE_KEY);
    localStorage.removeItem(HERB_TABLE_STORAGE_KEY);
    localStorage.removeItem(HERB_EXPERIMENT_STORAGE_KEY);
    localStorage.removeItem(RESOURCE_STORAGE_KEY);
    localStorage.removeItem('craftkeeper.theme');
  });

  it('redirects the root URL to Alchemy and renders the herb notebook and finder', async () => {
    const fixture = await createAppFixture();
    const host = fixture.nativeElement as HTMLElement;
    expect(TestBed.inject(Router).url).toBe('/alchemy');
    expect(host.querySelector('.nav-item.active')?.textContent).toContain('Alchemy');
    expect(host.querySelectorAll('.herb-table').length).toBe(15);
    expect(host.querySelectorAll('.effect-choices input').length).toBe(13);
    expect(host.querySelectorAll('.herb-table select').length).toBe(15 * 4);
    expect(host.querySelectorAll('.experiment-row input').length).toBe(13);
    expect(host.querySelector<HTMLDetailsElement>('.notebook-section')?.open).toBeFalse();
    expect(host.querySelector('.estimator-heading')).toBeNull();
    expect(host.textContent).not.toContain('Find matching recipes');
    expect(host.querySelector('.search-button')).toBeNull();
    expect(host.textContent).toContain('Herb strength experiment');
    expect(host.textContent).not.toContain('Add recipe');
    fixture.destroy();
  });

  it('renders Resources directly from its URL', async () => {
    const fixture = await createAppFixture('/resources');
    const host = fixture.nativeElement as HTMLElement;
    expect(TestBed.inject(Router).url).toBe('/resources');
    expect(host.querySelector('.resources-workspace')).not.toBeNull();
    expect(host.querySelector('.nav-item.active')?.textContent).toContain('Resources');
    expect(host.querySelector<HTMLAnchorElement>('.sidebar a[routerLink="/resources"]')?.getAttribute('aria-current')).toBe('page');
    fixture.destroy();
  });

  it('provides labeled navigation, a skip link, and an Alchemy page heading', async () => {
    const fixture = await createAppFixture();
    const host = fixture.nativeElement as HTMLElement;
    const nav = host.querySelector('nav[aria-label="Primary navigation"]');
    const alchemyLink = nav?.querySelector<HTMLAnchorElement>('a[routerLink="/alchemy"]');
    const resourcesLink = nav?.querySelector<HTMLAnchorElement>('a[routerLink="/resources"]');

    expect(host.querySelector<HTMLAnchorElement>('.skip-link')?.getAttribute('href')).toBe('#main-content');
    expect(host.querySelector('main#main-content')).not.toBeNull();
    expect(alchemyLink?.querySelector('.nav-label')?.textContent).toBe('AlchemyHerb notebook');
    expect(resourcesLink?.querySelector('.nav-label')?.textContent).toBe('ResourcesField discoveries');
    expect(nav?.querySelectorAll('.nav-icon[aria-hidden="true"]').length).toBe(3);
    expect(host.querySelector('.estimator h1#alchemy-title')?.textContent?.trim()).toBe('Alchemy');
    fixture.destroy();
  });

  it('leaves legacy recipe storage unchanged while loading the herb notebook', async () => {
    const legacyRecipes = '[{"id":"legacy","name":"Old potion","ingredients":[],"effects":[]}]';
    const herbTables = JSON.stringify([
      { herbId: 'herb-1', effects: [{ effectId: 'effect-3', power: 0.9 }], effectsComplete: false }
    ]);
    localStorage.setItem(ALCHEMY_STORAGE_KEY, legacyRecipes);
    localStorage.setItem(HERB_TABLE_STORAGE_KEY, herbTables);

    const fixture = await createAppFixture();
    expect(localStorage.getItem(ALCHEMY_STORAGE_KEY)).toBe(legacyRecipes);
    expect(localStorage.getItem(HERB_TABLE_STORAGE_KEY)).toBe(herbTables);
    expect(fixture.nativeElement.textContent).toContain('1 known effect');
    fixture.destroy();
  });

  it('persists theme choices and ignores invalid saved theme values', async () => {
    const fixture = await createAppFixture();
    fixture.componentInstance.setTheme('dark');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.app-shell').getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('craftkeeper.theme')).toBe('dark');

    localStorage.setItem('craftkeeper.theme', 'invalid');
    expect(TestBed.createComponent(AppComponent).componentInstance.theme).toBe('system');
    fixture.destroy();
  });

  it('switches themes from the sidebar and marks the selected option', async () => {
    const fixture = await createAppFixture();
    const buttons: NodeListOf<HTMLButtonElement> = fixture.nativeElement.querySelectorAll('.sidebar .theme-picker button');
    expect(buttons.length).toBe(3);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    buttons[2].click();
    fixture.detectChanges();
    expect(buttons[2].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[0].getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem('craftkeeper.theme')).toBe('dark');
    fixture.destroy();
  });

  it('switches routes from the sidebar links', async () => {
    const fixture = await createAppFixture();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.resources-workspace')).toBeNull();

    const resourcesLink = host.querySelector<HTMLAnchorElement>('.sidebar a[routerLink="/resources"]')!;
    resourcesLink.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(TestBed.inject(Router).url).toBe('/resources');
    expect(resourcesLink.getAttribute('aria-current')).toBe('page');
    expect(host.querySelector('.resources-workspace')).not.toBeNull();
    expect(host.querySelector('.nav-item.active')?.textContent).toContain('Resources');

    host.querySelector<HTMLAnchorElement>('.sidebar a[routerLink="/alchemy"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(TestBed.inject(Router).url).toBe('/alchemy');
    expect(host.querySelector('.resources-workspace')).toBeNull();
    fixture.destroy();
  });
});