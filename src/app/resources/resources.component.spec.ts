import { fakeAsync, flush, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { OptimalRouteSearch, PORTALS, ResourceNode, ResourceRepository, RESOURCE_STORAGE_KEY, createResourceShareCode } from './resources';
import { ResourcesComponent } from './resources.component';

const node = (type: ResourceNode['type'], q: number, r: number, quality = 100): ResourceNode => ({ type, q, r, quality });

describe('ResourcesComponent', () => {
  beforeEach(async () => {
    localStorage.removeItem(RESOURCE_STORAGE_KEY);
    await TestBed.configureTestingModule({ imports: [ResourcesComponent] }).compileComponents();
  });

  afterEach(() => localStorage.removeItem(RESOURCE_STORAGE_KEY));

  it('adds a default-quality node and persists it', () => {
    const fixture = TestBed.createComponent(ResourcesComponent);
    const component = fixture.componentInstance;
    component.type = 'hardwood';
    component.q = -8;
    component.r = 14;
    component.saveNode();
    fixture.detectChanges();

    expect(new ResourceRepository().list()).toEqual([node('hardwood', -8, 14)]);
    expect(fixture.nativeElement.querySelector('.quality-perfect')).not.toBeNull();
    fixture.destroy();
  });

  it('keeps malformed saved data untouched when the component cannot load storage', () => {
    localStorage.setItem(RESOURCE_STORAGE_KEY, '{broken');
    const fixture = TestBed.createComponent(ResourcesComponent);
    const component = fixture.componentInstance;
    component.saveNode();
    fixture.detectChanges();

    expect(component.storageError).toContain('Unable to read saved resources');
    expect(localStorage.getItem(RESOURCE_STORAGE_KEY)).toBe('{broken');
    expect(fixture.nativeElement.textContent).toContain('Existing data has not been changed');
    fixture.destroy();
  });

  it('edits a saved node without leaving its selection behind at the old coordinate', () => {
    const original = node('iron-ore', 4, -2, 55);
    new ResourceRepository().save([original]);
    const fixture = TestBed.createComponent(ResourcesComponent);
    const component = fixture.componentInstance;
    component.toggleNode(original);
    component.editNode(original);
    component.q = 5;
    component.quality = 72;
    component.saveNode();

    const updated = node('iron-ore', 5, -2, 72);
    expect(new ResourceRepository().list()).toEqual([updated]);
    expect(component.selectedNodes).toEqual([updated]);
    expect(component.quality).toBe(100);
    fixture.destroy();
  });

  it('names node actions by resource and coordinate and keeps focus during edit and removal', () => {
    const original = node('iron-ore', 4, -2, 55);
    new ResourceRepository().save([original]);
    const fixture = TestBed.createComponent(ResourcesComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const card = host.querySelector<HTMLElement>('.resource-card')!;
    const editButton = card.querySelector<HTMLButtonElement>('.card-actions button')!;
    const removeButton = card.querySelectorAll<HTMLButtonElement>('.card-actions button')[1];

    expect(editButton.getAttribute('aria-label')).toContain('q 4, r -2');
    expect(removeButton.getAttribute('aria-label')).toContain('q 4, r -2');

    editButton.click();
    fixture.detectChanges();
    expect(document.activeElement).toBe(host.querySelector('[name="resourceType"]'));
    expect(host.querySelector('#node-form-title')?.textContent).toContain('Edit resource node');

    card.querySelector<HTMLButtonElement>('.card-actions button:nth-child(2)')!.click();
    fixture.detectChanges();
    expect(document.activeElement).toBe(host.querySelector('#discovered-title'));
    expect(fixture.componentInstance.resourceNodes).toEqual([]);
    fixture.destroy();
  });

  it('combines type and quality filters for bulk selection while keeping selection additive', () => {
    const lowHardwood = node('hardwood', 1, 0, 20);
    const midHardwood = node('hardwood', 2, 0, 70);
    const lowSoftwood = node('softwood', 3, 0, 25);
    new ResourceRepository().save([lowHardwood, midHardwood, lowSoftwood]);
    const fixture = TestBed.createComponent(ResourcesComponent);
    const component = fixture.componentInstance;
    component.selectedTypes = new Set(['hardwood', 'softwood']);
    component.selectedBands = new Set(['low']);
    component.selectVisible();
    expect(component.filteredNodes).toEqual([lowHardwood, lowSoftwood]);
    expect(component.selectedNodes).toEqual([lowHardwood, lowSoftwood]);

    component.toggleNode(midHardwood);
    expect(component.selectedNodes).toEqual([lowHardwood, midHardwood, lowSoftwood]);
    component.deselectVisible();
    expect(component.selectedNodes).toEqual([midHardwood]);
    fixture.destroy();
  });

  it('exports selected nodes and imports by merging without replacing existing discoveries', () => {
    const saved = node('hardwood', 1, 1, 40);
    new ResourceRepository().save([saved]);
    const fixture = TestBed.createComponent(ResourcesComponent);
    const component = fixture.componentInstance;
    component.toggleNode(saved);
    component.createShareCode();
    expect(component.shareCode.startsWith('res1.')).toBeTrue();

    component.shareCode = createResourceShareCode([node('hardwood', 1, 1, 99), node('clay', 7, -3, 80)]);
    component.importShareCode();
    expect(new ResourceRepository().list()).toEqual([saved, node('clay', 7, -3, 80)]);
    expect(component.shareMessage).toContain('Imported 1; skipped 1');

    const before = localStorage.getItem(RESOURCE_STORAGE_KEY);
    component.shareCode = 'not-a-code';
    component.importShareCode();
    expect(localStorage.getItem(RESOURCE_STORAGE_KEY)).toBe(before);
    expect(component.shareMessage).toContain('not a supported resource import code');
    fixture.destroy();
  });

  it('filters nodes from the type and quality checkbox dropdowns', () => {
    const lowHardwood = node('hardwood', 1, 0, 20);
    const highSoftwood = node('softwood', 2, 0, 95);
    const lowSoftwood = node('softwood', 3, 0, 25);
    new ResourceRepository().save([lowHardwood, highSoftwood, lowSoftwood]);
    const fixture = TestBed.createComponent(ResourcesComponent);
    fixture.detectChanges();

    const dropdowns = fixture.nativeElement.querySelectorAll('details.filter-dropdown') as NodeListOf<HTMLDetailsElement>;
    expect(dropdowns.length).toBe(2);
    expect(dropdowns[0].open).toBeFalse();
    dropdowns[0].querySelector('summary')!.click();
    const typeChecks = dropdowns[0].querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
    typeChecks[0].click();
    dropdowns[1].querySelector('summary')!.click();
    const qualityChecks = dropdowns[1].querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
    qualityChecks[3].click();
    fixture.detectChanges();

    expect(fixture.componentInstance.filteredNodes).toEqual([lowSoftwood]);
    expect(fixture.nativeElement.querySelectorAll('.resource-card').length).toBe(1);
    fixture.destroy();
  });

  it('selects and deselects all type and quality filters without changing node selection', () => {
    const lowHardwood = node('hardwood', 1, 0, 20);
    const highSoftwood = node('softwood', 2, 0, 95);
    const lowSoftwood = node('softwood', 3, 0, 25);
    new ResourceRepository().save([lowHardwood, highSoftwood, lowSoftwood]);
    const fixture = TestBed.createComponent(ResourcesComponent);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const dropdowns = fixture.nativeElement.querySelectorAll('details.filter-dropdown') as NodeListOf<HTMLDetailsElement>;
    const typeActions = dropdowns[0].querySelectorAll('.filter-bulk-actions button') as NodeListOf<HTMLButtonElement>;
    const qualityActions = dropdowns[1].querySelectorAll('.filter-bulk-actions button') as NodeListOf<HTMLButtonElement>;
    const typeChecks = dropdowns[0].querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
    const qualityChecks = dropdowns[1].querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;

    fixture.nativeElement.querySelector('.select-node input')!.click();
    typeActions[1].click();
    fixture.detectChanges();
    expect(component.selectedTypes.size).toBe(0);
    expect(component.filteredNodes).toEqual([]);
    expect(component.selectedNodes).toEqual([lowHardwood]);
    expect(Array.from(typeChecks).every(input => !input.checked)).toBeTrue();

    typeActions[0].click();
    fixture.detectChanges();
    expect(component.filteredNodes).toEqual([lowHardwood, highSoftwood, lowSoftwood]);
    expect(Array.from(typeChecks).every(input => input.checked)).toBeTrue();

    qualityActions[1].click();
    fixture.detectChanges();
    expect(component.selectedBands.size).toBe(0);
    expect(component.filteredNodes).toEqual([]);
    expect(component.selectedNodes).toEqual([lowHardwood]);
    expect(Array.from(qualityChecks).every(input => !input.checked)).toBeTrue();

    qualityActions[0].click();
    fixture.detectChanges();
    for (const qualityCheck of Array.from(qualityChecks).slice(1)) qualityCheck.click();
    fixture.detectChanges();
    expect(component.selectedBands.size).toBe(1);
    expect(component.filteredNodes).toEqual([lowHardwood, lowSoftwood]);
    expect(component.selectedNodes).toEqual([lowHardwood]);
    fixture.destroy();
  });

  it('uses outline-only quality highlighting with a subtle perfect glow in light and dark themes', () => {
    const nodes = [
      node('hardwood', 1, 0, 20),
      node('hardwood', 2, 0, 40),
      node('hardwood', 3, 0, 70),
      node('hardwood', 4, 0, 95),
      node('hardwood', 5, 0, 100)
    ];
    new ResourceRepository().save(nodes);
    for (const theme of ['light', 'dark']) {
      const fixture = TestBed.createComponent(ResourcesComponent);
      fixture.componentInstance.toggleNode(nodes[0]);
      fixture.componentInstance.toggleNode(nodes[4]);
      const shell = document.createElement('div');
      shell.className = 'app-shell';
      shell.dataset['theme'] = theme;
      shell.append(fixture.nativeElement);
      document.body.append(shell);
      fixture.detectChanges();
      const expectedLowBorder = theme === 'dark' ? '#987353' : '#c9a17f';
      expect(getComputedStyle(document.body).getPropertyValue('--quality-low-border').trim()).toBe(expectedLowBorder);
      expect(getComputedStyle(fixture.nativeElement).getPropertyValue('--quality-low-border').trim()).toBe(expectedLowBorder);
      const cards = Array.from(fixture.nativeElement.querySelectorAll('.resource-card')) as HTMLElement[];
      expect(getComputedStyle(cards[0]).getPropertyValue('--quality-low-border').trim()).toBe(expectedLowBorder);
      const backdrops = cards.map(card => getComputedStyle(card).backgroundColor);
      const badges = cards.map(card => getComputedStyle(card.querySelector('.quality-badge')!).backgroundColor);
      const borders = cards.map(card => getComputedStyle(card).borderTopColor);
      const swatches = Array.from(fixture.nativeElement.querySelectorAll('.quality-swatch')) as HTMLElement[];

      expect(cards.length).toBe(5);
      expect(new Set(backdrops).size).toBe(1);
      expect(new Set(badges).size).toBe(1);
      expect(new Set(borders).size).toBe(5);
      expect(cards.slice(0, 4).every(card => getComputedStyle(card).boxShadow === 'none')).toBeTrue();
      expect(getComputedStyle(cards[4]).boxShadow).not.toBe('none');
      expect(cards.every(card => getComputedStyle(card.querySelector('.quality-badge')!).boxShadow === 'none')).toBeTrue();
      expect(new Set(swatches.map(swatch => getComputedStyle(swatch).backgroundColor)).size).toBe(1);
      expect(new Set(swatches.map(swatch => getComputedStyle(swatch).boxShadow)).size).toBe(1);

      const selected = cards[0];
      const selectedStyle = getComputedStyle(selected);
      expect(selected.classList.contains('is-selected')).toBeTrue();
      expect(selectedStyle.outlineStyle).toBe('solid');
      expect(selectedStyle.outlineWidth).toBe('2px');
      expect(selectedStyle.outlineOffset).toBe('2px');
      expect(selectedStyle.borderTopColor).toBe(borders[0]);
      const selectedPerfect = cards[4];
      const selectedPerfectStyle = getComputedStyle(selectedPerfect);
      expect(selectedPerfect.classList.contains('is-selected')).toBeTrue();
      expect(selectedPerfectStyle.outlineStyle).toBe('solid');
      expect(selectedPerfectStyle.outlineWidth).toBe('2px');
      expect(selectedPerfectStyle.boxShadow).not.toBe('none');
      expect(selectedPerfectStyle.borderTopColor).toBe(borders[4]);
      fixture.destroy();
      shell.remove();
    }
  });

  it('imports raw text and keeps existing discoveries when any row is invalid', () => {
    const saved = node('hardwood', 1, 1, 40);
    new ResourceRepository().save([saved]);
    const fixture = TestBed.createComponent(ResourcesComponent);
    const component = fixture.componentInstance;
    component.rawResourceText = 'Oak 1 1 99\nIron ore, 3, -4, 76';
    component.importRawResources();

    expect(new ResourceRepository().list()).toEqual([saved, node('iron-ore', 3, -4, 76)]);
    expect(component.shareMessage).toContain('Imported 1; skipped 1');

    const before = localStorage.getItem(RESOURCE_STORAGE_KEY);
    component.rawResourceText = 'Clay 8 9\nUnknown 10 11';
    component.importRawResources();
    expect(localStorage.getItem(RESOURCE_STORAGE_KEY)).toBe(before);
    expect(component.shareMessage).toContain('Line 2: unknown resource type');
    fixture.destroy();
  });

  it('offers Flint as a selectable resource and imports grouped quality coordinates', () => {
    const fixture = TestBed.createComponent(ResourcesComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    const options = fixture.nativeElement.querySelectorAll('select[name="resourceType"] option') as NodeListOf<HTMLOptionElement>;
    const flintOption = Array.from(options).find(option => option.value === 'flint');
    expect(flintOption?.textContent).toContain('Flint');

    component.type = 'flint';
    component.q = 9;
    component.r = -2;
    component.saveNode();
    component.rawResourceText = 'Flint: 80 (-4, 9), (0, 2); 100 (3, -6)';
    component.importRawResources();

    expect(new ResourceRepository().list()).toEqual([
      node('flint', 9, -2),
      node('flint', -4, 9, 80),
      node('flint', 0, 2, 80),
      node('flint', 3, -6)
    ]);
    expect(component.shareMessage).toContain('Imported 3');
    fixture.destroy();
  });

  it('loads and imports a local CSV file', async () => {
    const fixture = TestBed.createComponent(ResourcesComponent);
    await fixture.componentInstance.importRawFile(new File(['resource,q,r\nSand,-8,3'], 'resources.csv', { type: 'text/csv' }));

    expect(fixture.componentInstance.rawResourceText).toContain('Sand,-8,3');
    expect(new ResourceRepository().list()).toEqual([node('sand', -8, 3)]);
    expect(fixture.componentInstance.shareMessage).toContain('Imported 1');
    fixture.destroy();
  });

  it('plans by distance without a speed control and allows the scheduled exact search to be cancelled', fakeAsync(() => {
    const target = node('sand', 5, 2);
    new ResourceRepository().save([target]);
    const fixture = TestBed.createComponent(ResourcesComponent);
    const component = fixture.componentInstance;
    component.toggleNode(target);
    component.startQ = 0;
    component.startR = 0;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[name="walkingSpeed"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Allow 20 minutes between portal uses');
    component.generateRoute();
    flush();
    fixture.detectChanges();
    expect(component.route?.totalDistance).toBe(7);
    expect(fixture.nativeElement.textContent).toContain('7 hexes');
    expect(fixture.nativeElement.textContent).not.toContain('Estimated elapsed time');
    expect(component.routeStatus).toBe('');
    expect(fixture.nativeElement.textContent).not.toContain('Optimal route proven.');
    expect(fixture.nativeElement.querySelector('.route-result h3').textContent).toBe('Optimal route');
    expect(component.routeSteps.length).toBe(1);
    expect(fixture.nativeElement.querySelector('.portal-step')).toBeNull();
    expect(component.routeOptimal).toBeTrue();

    component.selectedKeys.add('sand:6:2');
    component.resourceNodes.push(node('sand', 6, 2));
    component.generateRoute();
    expect(component.routeStatus).toContain('Searching');
    const bestRoute = component.route;
    component.cancelRoute();
    expect(component.routeStatus).toBe('Search cancelled.');
    expect(component.route).toBe(bestRoute);
    expect(component.routeOptimal).toBeFalse();
    flush();
    fixture.destroy();
  }));

  it('renders each portal as its own numbered step and splits walking distances across mixed legs', fakeAsync(() => {
    const nodes = [
      node('clay', 0, 0),
      node('silver-ore', 176, -149),
      node('granite-outcrop', 293, -246)
    ];
    new ResourceRepository().save(nodes);
    const fixture = TestBed.createComponent(ResourcesComponent);
    const component = fixture.componentInstance;
    nodes.forEach(item => component.toggleNode(item));
    component.startQ = 0;
    component.startR = 0;
    component.usePortals = true;

    component.generateRoute();
    flush();
    fixture.detectChanges();

    expect(component.route!.totalDistance).toBe(4);
    expect(component.route!.stops.length).toBe(3);
    expect(component.route!.portals.length).toBe(2);
    expect(component.routeSteps.map(step => step.kind)).toEqual(['resource', 'portal', 'resource', 'portal', 'resource']);
    expect(component.routeSteps.map(step => step.distanceFromPrevious)).toEqual([0, 4, 0, 0, 0]);
    const routeItems = fixture.nativeElement.querySelectorAll('.route-stops li') as NodeListOf<HTMLElement>;
    expect(routeItems.length).toBe(5);
    expect(Array.from(routeItems, item => item.querySelector('.stop-number')!.textContent!.trim())).toEqual(['1', '2', '3', '4', '5']);
    expect(routeItems[1].textContent).toContain('Portal:');
    expect(routeItems[1].textContent).toContain('Walk 4 hexes');
    expect(routeItems[2].textContent).toContain('from portal exit');
    expect(routeItems[3].textContent).toContain('Portal:');
    expect(fixture.nativeElement.querySelector('.route-summary').textContent).toContain('3 resource stops · 2 portals used');
    fixture.destroy();
  }));

  it('shows only a destination copy button and never displays portal addresses', async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = jasmine.createSpy('writeText').and.returnValue(Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const fixture = TestBed.createComponent(ResourcesComponent);
    const component = fixture.componentInstance;
    const from = { name: 'Entrance', q: 0, r: 0, address: 'portal://entrance-address' };
    const to = { name: 'Exit', q: 10, r: 0, address: 'portal://exit-address' };
    const target = node('sand', 10, 0);
    component.route = {
      totalDistance: 0,
      stops: [{ node: target, distanceFromPrevious: 0, portal: { from, to } }],
      portals: [{ from, to }]
    };
    component.routeSnapshot = { start: { q: 0, r: 0 }, usePortals: true, targetCount: 1 };
    fixture.detectChanges();

    try {
      const portalStep = fixture.nativeElement.querySelector('.portal-step') as HTMLElement;
      const buttons = portalStep.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
      expect(portalStep.textContent).not.toContain('portal://entrance-address');
      expect(portalStep.textContent).not.toContain('portal://exit-address');
      expect(portalStep.querySelectorAll('code').length).toBe(0);
      expect(buttons.length).toBe(1);
      expect(buttons[0].getAttribute('aria-label')).toBe('Copy destination address for Exit');
      buttons[0].click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(writeText).toHaveBeenCalledWith('portal://exit-address');
      expect(component.portalCopyMessage).toBe('Copied address for Exit.');
    } finally {
      fixture.destroy();
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('does not show a copy button when the destination address is unknown', () => {
    const fixture = TestBed.createComponent(ResourcesComponent);
    const component = fixture.componentInstance;
    const from = { name: 'Known entrance', q: 0, r: 0, address: 'portal://entrance-address' };
    const to = { name: 'Unknown exit', q: 10, r: 0 };
    const target = node('sand', 10, 0);
    component.route = {
      totalDistance: 0,
      stops: [{ node: target, distanceFromPrevious: 0, portal: { from, to } }],
      portals: [{ from, to }]
    };
    component.routeSnapshot = { start: { q: 0, r: 0 }, usePortals: true, targetCount: 1 };
    fixture.detectChanges();

    const portalStep = fixture.nativeElement.querySelector('.portal-step') as HTMLElement;
    expect(portalStep.textContent).not.toContain('portal://entrance-address');
    expect(portalStep.querySelector('button')).toBeNull();
    fixture.destroy();
  });

  it('shows distance-matched Scorched March addresses on route endpoints and copies them', fakeAsync(() => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = jasmine.createSpy('writeText').and.returnValue(Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const from = PORTALS.find(portal => portal.name === 'Scorched March 1')!;
    const to = PORTALS.find(portal => portal.name === 'Scorched March 2')!;
    const target = node('sand', to.q, to.r);
    new ResourceRepository().save([target]);
    const fixture = TestBed.createComponent(ResourcesComponent);
    const component = fixture.componentInstance;
    component.toggleNode(target);
    component.startQ = from.q;
    component.startR = from.r;
    component.usePortals = true;

    try {
      component.generateRoute();
      flush();
      fixture.detectChanges();

      const portalStep = fixture.nativeElement.querySelector('.route-stops li.portal-step') as HTMLElement;
      expect(portalStep.textContent).not.toContain('Confirmed entrance');
      expect(portalStep.textContent).not.toContain('Confirmed exit');
      expect(portalStep.textContent).not.toContain('01-10-05-10-10-06-06');
      expect(portalStep.textContent).not.toContain('04-09-03-12-06-05-04');
      const buttons = portalStep.querySelectorAll('button') as NodeListOf<HTMLButtonElement>;
      expect(buttons.length).toBe(1);
      expect(buttons[0].getAttribute('aria-label')).toBe('Copy destination address for Scorched March 2');
      buttons[0].click();
      flushMicrotasks();
      fixture.detectChanges();
      expect(writeText).toHaveBeenCalledWith('04-09-03-12-06-05-04');
      expect(component.portalCopyMessage).toBe('Copied address for Scorched March 2.');
    } finally {
      fixture.destroy();
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  }));

  it('shows destination candidate copy buttons without revealing uncertain addresses', fakeAsync(() => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = jasmine.createSpy('writeText').and.returnValue(Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const candidates = ['10-07-02-05-06-02-08', '03-05-05-09-07-04-09'];
    const from = { ...PORTALS.find(portal => portal.name === 'Lakewilds 1')!, address: undefined, possibleAddresses: candidates };
    const to = { ...PORTALS.find(portal => portal.name === 'Lakewilds 2')!, address: undefined, possibleAddresses: candidates };
    const target = node('sand', to.q, to.r);
    const fixture = TestBed.createComponent(ResourcesComponent);
    const component = fixture.componentInstance;
    component.route = {
      totalDistance: 0,
      stops: [{ node: target, distanceFromPrevious: 0, portal: { from, to } }],
      portals: [{ from, to }]
    };
    component.routeSnapshot = { start: from, usePortals: true, targetCount: 1 };

    try {
      fixture.detectChanges();

      const portalStep = fixture.nativeElement.querySelector('.route-stops li.portal-step') as HTMLElement;
      expect(portalStep.textContent).toContain('Possible Lakewilds addresses (match unknown)');
      expect(portalStep.querySelectorAll('.portal-address-candidates').length).toBe(1);
      expect(portalStep.querySelectorAll('.portal-address-candidates code').length).toBe(0);
      expect(portalStep.textContent).not.toContain('10-07-02-05-06-02-08');
      expect(portalStep.textContent).not.toContain('03-05-05-09-07-04-09');
      const candidateButtons = portalStep.querySelectorAll('.portal-address-candidates button') as NodeListOf<HTMLButtonElement>;
      expect(candidateButtons.length).toBe(2);
      expect(candidateButtons[0].getAttribute('aria-label')).toContain('portal match unknown');
      candidateButtons[0].click();
      flushMicrotasks();
      fixture.detectChanges();
      expect(writeText).toHaveBeenCalledWith('10-07-02-05-06-02-08');
      expect(component.portalCopyMessage).toBe('Copied a possible Lakewilds address; portal match unknown.');
    } finally {
      fixture.destroy();
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  }));

  it('copies only the destination Lakewilds address on a generated route', fakeAsync(() => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = jasmine.createSpy('writeText').and.returnValue(Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const from = PORTALS.find(portal => portal.name === 'Lakewilds 1')!;
    const to = PORTALS.find(portal => portal.name === 'Lakewilds 2')!;
    const target = node('sand', to.q, to.r);
    new ResourceRepository().save([target]);
    const fixture = TestBed.createComponent(ResourcesComponent);
    const component = fixture.componentInstance;
    component.toggleNode(target);
    component.startQ = from.q;
    component.startR = from.r;
    component.usePortals = true;

    try {
      component.generateRoute();
      flush();
      fixture.detectChanges();
      const portalStep = fixture.nativeElement.querySelector('.route-stops li.portal-step') as HTMLElement;
      expect(portalStep.textContent).not.toContain('03-05-05-09-07-04-09');
      expect(portalStep.textContent).not.toContain('10-07-02-05-06-02-08');
      expect(portalStep.querySelector('.portal-address-candidates')).toBeNull();
      const button = portalStep.querySelector('[aria-label="Copy destination address for Lakewilds 2"]') as HTMLButtonElement;
      button.click();
      flushMicrotasks();
      expect(writeText).toHaveBeenCalledWith('10-07-02-05-06-02-08');
    } finally {
      fixture.destroy();
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  }));

  it('falls back after clipboard rejection and reports when copying fails', async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = jasmine.createSpy('writeText').and.returnValue(Promise.reject(new Error('permission denied')));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const fallbackCopy = spyOn(document, 'execCommand').and.returnValue(true);
    const fixture = TestBed.createComponent(ResourcesComponent);
    const component = fixture.componentInstance;
    try {
      await component.copyPortalAddress('portal://known-address', 'Known portal');
      expect(writeText).toHaveBeenCalledWith('portal://known-address');
      expect(fallbackCopy).toHaveBeenCalledWith('copy');
      expect(component.portalCopyMessage).toBe('Copied address for Known portal.');
    } finally {
      fixture.destroy();
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }

    const unavailableDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    fallbackCopy.calls.reset();
    fallbackCopy.and.returnValue(false);
    const secondFixture = TestBed.createComponent(ResourcesComponent);
    try {
      await secondFixture.componentInstance.copyPortalAddress('portal://known-address', 'Known portal');
      expect(fallbackCopy).toHaveBeenCalledWith('copy');
      expect(secondFixture.componentInstance.portalCopyMessage).toBe('Could not copy address for Known portal.');
    } finally {
      secondFixture.destroy();
      if (unavailableDescriptor) Object.defineProperty(navigator, 'clipboard', unavailableDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('uses the captured route start when deriving its first portal step', fakeAsync(() => {
    const target = node('sand', 176, -149);
    new ResourceRepository().save([target]);
    const fixture = TestBed.createComponent(ResourcesComponent);
    const component = fixture.componentInstance;
    component.toggleNode(target);
    component.startQ = -4;
    component.startR = 1;
    component.usePortals = true;

    component.generateRoute();
    expect(component.routeSteps[0].kind).toBe('portal');
    expect(component.routeSteps[0].distanceFromPrevious).toBe(0);
    component.startQ = 100;
    component.startR = 100;
    expect(component.routeSteps[0].distanceFromPrevious).toBe(0);
    expect(component.routeSnapshot!.start).toEqual({ q: -4, r: 1 });
    flush();
    fixture.destroy();
  }));

  it('immediately displays a complete approximate route for 20 targets and retains it on cancellation', fakeAsync(() => {
    const nodes = Array.from({ length: 20 }, (_, index) => node('sand', index + 1, index % 3));
    new ResourceRepository().save(nodes);
    const fixture = TestBed.createComponent(ResourcesComponent);
    const component = fixture.componentInstance;
    nodes.forEach(item => component.toggleNode(item));
    component.startQ = 4;
    component.startR = -2;
    component.usePortals = true;

    component.generateRoute();
    fixture.detectChanges();
    expect(component.route?.stops.length).toBe(20);
    expect(fixture.nativeElement.querySelectorAll('.route-stops li').length).toBe(component.routeSteps.length);
    expect(fixture.nativeElement.querySelector('.route-result').textContent).toContain('Approximate route');
    expect(fixture.nativeElement.querySelector('.route-result').textContent).toContain('20 targets · start q 4, r -2 · portals on');
    expect(fixture.nativeElement.textContent).toContain('Cancel search');

    component.routeStatus = 'Custom status';
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Cancel search');
    component.startQ = 50;
    component.usePortals = false;
    component.clearSelection();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.route-result').textContent).toContain('20 targets · start q 4, r -2 · portals on');
    const bestRoute = component.route;
    component.cancelRoute();
    fixture.detectChanges();
    expect(component.route).toBe(bestRoute);
    expect(component.routeStatus).toContain('cancelled');
    expect(fixture.nativeElement.querySelector('.route-result').textContent).toContain('Approximate route');
    expect(fixture.nativeElement.textContent).not.toContain('Cancel search');
    fixture.destroy();
  }));

  it('proves a 20-target route when A* completes within the search deadline', fakeAsync(() => {
    const nodes = Array.from({ length: 20 }, (_, i) => node('sand', i * 19 - 180, (i * 43 % 251) - 125));
    new ResourceRepository().save(nodes);
    const fixture = TestBed.createComponent(ResourcesComponent);
    const component = fixture.componentInstance;
    nodes.forEach(item => component.toggleNode(item));
    component.usePortals = true;
    component.generateRoute();
    const initialDistance = component.route!.totalDistance;

    tick(3001);
    fixture.detectChanges();
    expect(component.routeSearching).toBeFalse();
    expect(component.route!.stops.length).toBe(20);
    expect(component.route!.totalDistance).toBeLessThanOrEqual(initialDistance);
    expect(component.routeOptimal).toBeTrue();
    expect(component.routeStatus).toBe('');
    expect(fixture.nativeElement.textContent).not.toContain('Optimal route proven.');
    expect(fixture.nativeElement.querySelector('.route-result h3').textContent).toBe('Optimal route');
    fixture.destroy();
  }));

  it('counts construction and batch execution toward the time limit', fakeAsync(() => {
    const target = node('sand', 5, 2);
    new ResourceRepository().save([target]);
    const fixture = TestBed.createComponent(ResourcesComponent);
    const component = fixture.componentInstance;
    component.toggleNode(target);
    let now = 1000;
    const clock = spyOn(Date, 'now').and.callFake(() => now);
    const process = spyOn(OptimalRouteSearch.prototype, 'processNext').and.callFake(() => {
      now += 3000;
      return false;
    });
    const cancel = spyOn(OptimalRouteSearch.prototype, 'cancel').and.callThrough();

    component.generateRoute();
    const bestRoute = component.route;
    tick(1);
    expect(process).toHaveBeenCalledOnceWith(200);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(component.route).toBe(bestRoute);
    expect(component.routeStatus).toContain('Time limit');
    expect(component.routeSearching).toBeFalse();

    clock.and.returnValues(5000, 8000);
    component.generateRoute();
    expect(process).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(component.route?.stops.length).toBe(1);
    expect(component.routeStatus).toContain('Time limit');
    expect(component.routeSearching).toBeFalse();
    fixture.destroy();
  }));

  it('processes bounded batches, publishes improvements, and stops at the wall-clock limit', fakeAsync(() => {
    const targets = [node('sand', 5, 2), node('clay', 8, 3)];
    new ResourceRepository().save(targets);
    const fixture = TestBed.createComponent(ResourcesComponent);
    const component = fixture.componentInstance;
    targets.forEach(item => component.toggleNode(item));
    let now = 1000;
    spyOn(Date, 'now').and.callFake(() => now);
    const process = spyOn(OptimalRouteSearch.prototype, 'processNext').and.returnValue(false);
    component.generateRoute();
    const initial = component.route!;
    const improved = { ...initial, totalDistance: initial.totalDistance - 1 };
    spyOnProperty(OptimalRouteSearch.prototype, 'result', 'get').and.returnValue(improved);

    expect(process).not.toHaveBeenCalled();
    tick(1);
    expect(process).toHaveBeenCalledOnceWith(200);
    expect(component.route).toBe(improved);
    now += 3000;
    tick(1);
    expect(process).toHaveBeenCalledTimes(1);
    expect(component.route).toBe(improved);
    expect(component.routeStatus).toContain('Time limit');
    expect(component.routeOptimal).toBeFalse();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.route-result').textContent).toContain('Approximate route');
    fixture.destroy();
  }));

  it('retains the approximate route and reports the state safety limit', fakeAsync(() => {
    const target = node('sand', 5, 2);
    new ResourceRepository().save([target]);
    const fixture = TestBed.createComponent(ResourcesComponent);
    const component = fixture.componentInstance;
    component.toggleNode(target);
    spyOn(OptimalRouteSearch.prototype, 'processNext').and.returnValue(true);
    spyOnProperty(OptimalRouteSearch.prototype, 'error', 'get').and.returnValue('State safety limit reached.');

    component.generateRoute();
    const bestRoute = component.route;
    tick(1);
    fixture.detectChanges();
    expect(component.route).toBe(bestRoute);
    expect(component.routeError).toContain('State safety limit');
    expect(component.routeStatus).toBe('');
    expect(component.routeOptimal).toBeFalse();
    expect(fixture.nativeElement.querySelector('.route-result').textContent).toContain('Approximate route');
    fixture.destroy();
  }));

  it('cleans up cancelled and replaced searches, ignores stale callbacks, and clears old messages on invalid restart', fakeAsync(() => {
    const target = node('sand', 5, 2);
    new ResourceRepository().save([target]);
    const fixture = TestBed.createComponent(ResourcesComponent);
    const component = fixture.componentInstance;
    component.toggleNode(target);
    const process = spyOn(OptimalRouteSearch.prototype, 'processNext').and.returnValue(false);
    const cancel = spyOn(OptimalRouteSearch.prototype, 'cancel').and.callThrough();
    const timer = spyOn(window, 'setTimeout').and.callThrough();

    component.generateRoute();
    const staleCallback = timer.calls.mostRecent().args[0] as () => void;
    component.cancelRoute();
    component.generateRoute();
    const replacement = component.route;
    staleCallback();
    expect(process).not.toHaveBeenCalled();
    expect(component.route).toBe(replacement);
    tick(1);
    expect(process).toHaveBeenCalledTimes(1);
    component.startQ = null;
    component.generateRoute();
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(component.route).toBeNull();
    expect(component.routeStatus).toBe('');
    expect(component.routeWarning).toBe('');
    expect(component.routeError).toContain('starting coordinates');
    tick(1);
    expect(process).toHaveBeenCalledTimes(1);
    fixture.destroy();
  }));

  it('cancels the active search and its timer when destroyed', fakeAsync(() => {
    const target = node('sand', 5, 2);
    new ResourceRepository().save([target]);
    const fixture = TestBed.createComponent(ResourcesComponent);
    const component = fixture.componentInstance;
    component.toggleNode(target);
    const process = spyOn(OptimalRouteSearch.prototype, 'processNext').and.returnValue(false);
    const cancel = spyOn(OptimalRouteSearch.prototype, 'cancel').and.callThrough();
    component.generateRoute();

    fixture.destroy();
    tick(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(process).not.toHaveBeenCalled();
  }));
});