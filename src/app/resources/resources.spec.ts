import {
  createResourceShareCode,
  decodeResourceShareCode,
  hexDistance,
  OptimalRouteSearch,
  parseResourceText,
  PORTALS,
  qualityBand,
  RESOURCE_CATALOG,
  RESOURCE_STORAGE_KEY,
  ResourceNode,
  ResourceRepository,
  validateResourceNode
} from './resources';

const testNode = (type: ResourceNode['type'], q: number, r: number, quality = 100): ResourceNode => ({ type, q, r, quality });

function completeRoute(search: OptimalRouteSearch) {
  while (!search.processNext(500)) { /* Process the exact search in test-sized chunks. */ }
  return search.result;
}

function referenceRouteScore(nodes: ResourceNode[], start: { q: number; r: number }, portals: Array<{ name: string; q: number; r: number }>) {
  const distance = (a: { q: number; r: number }, b: { q: number; r: number }) => {
    const dq = a.q - b.q;
    const dr = a.r - b.r;
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
  };
  let bestDistance = Infinity;
  let bestPortalCount = Infinity;

  const visit = (mask: number, lastIndex: number, totalDistance: number, portalCount: number): void => {
    if (mask === (1 << nodes.length) - 1) {
      if (totalDistance < bestDistance || (totalDistance === bestDistance && portalCount < bestPortalCount)) {
        bestDistance = totalDistance;
        bestPortalCount = portalCount;
      }
      return;
    }
    const origin = lastIndex < 0 ? start : nodes[lastIndex];
    for (let index = 0; index < nodes.length; index++) {
      if (mask & (1 << index)) continue;
      const target = nodes[index];
      let legDistance = distance(origin, target);
      let legPortalCount = 0;
      for (const from of portals) {
        for (const to of portals) {
          if (from.q === to.q && from.r === to.r) continue;
          const portalDistance = distance(origin, from) + distance(to, target);
          if (portalDistance < legDistance) {
            legDistance = portalDistance;
            legPortalCount = 1;
          }
        }
      }
      visit(mask | (1 << index), index, totalDistance + legDistance, portalCount + legPortalCount);
    }
  };

  visit(0, -1, 0, 0);
  return { totalDistance: bestDistance, portalCount: bestPortalCount };
}

describe('resource discovery data', () => {
  it('classifies every quality boundary into the intended band', () => {
    expect([1, 29, 30, 59, 60, 89, 90, 99, 100].map(qualityBand)).toEqual([
      'low', 'low', 'average', 'average', 'mid', 'mid', 'high', 'high', 'perfect'
    ]);
  });

  it('validates whole q/r coordinates, known resource types, and the 1–100 quality range', () => {
    expect(validateResourceNode(testNode('hardwood', -4, 9))).toBeTrue();
    expect(validateResourceNode({ ...testNode('hardwood', 0, 0), q: 1.5 })).toBeFalse();
    expect(validateResourceNode({ ...testNode('hardwood', 0, 0), quality: 0 })).toBeFalse();
    expect(validateResourceNode({ ...testNode('hardwood', 0, 0), type: 'oak' })).toBeFalse();
    expect(RESOURCE_CATALOG.find(resource => resource.id === 'hardwood')?.aliases).toEqual(['Oak']);
    expect(RESOURCE_CATALOG.find(resource => resource.id === 'softwood')?.aliases).toEqual(['Pine']);
  });

  it('parses canonical names and common aliases in text and CSV imports', () => {
    for (const resource of RESOURCE_CATALOG) {
      expect(parseResourceText(`${resource.name} -4 9`)).toEqual([testNode(resource.id, -4, 9)]);
      expect(parseResourceText(`${resource.id},5,-2,73`)).toEqual([testNode(resource.id, 5, -2, 73)]);
      for (const alias of resource.aliases) {
        expect(parseResourceText(`${alias.toUpperCase()} 7 -3`)).toEqual([testNode(resource.id, 7, -3)]);
        expect(parseResourceText(`${alias},-8,3`)).toEqual([testNode(resource.id, -8, 3)]);
      }
    }
  });

  it('parses grouped quality and coordinate imports alongside existing row formats', () => {
    expect(parseResourceText('Stone 45 (-4, 9), (0, 2); 100 (3, -6)\nFlint 75 (-8, 11)\nSand 1 4\nClay,5,6,30')).toEqual([
      testNode('boulder', -4, 9, 45),
      testNode('boulder', 0, 2, 45),
      testNode('boulder', 3, -6),
      testNode('flint', -8, 11, 75),
      testNode('sand', 1, 4),
      testNode('clay', 5, 6, 30)
    ]);
  });

  it('accepts a colon after a grouped resource name, including multiword names', () => {
    expect(parseResourceText('Clay: 100 (-120,35), (-135,75); 99 (27,-73), (186,-271), (47,254), (-8,-86); 98 (52,-137), (135,-90)')).toEqual([
      testNode('clay', -120, 35),
      testNode('clay', -135, 75),
      testNode('clay', 27, -73, 99),
      testNode('clay', 186, -271, 99),
      testNode('clay', 47, 254, 99),
      testNode('clay', -8, -86, 99),
      testNode('clay', 52, -137, 98),
      testNode('clay', 135, -90, 98)
    ]);
    expect(parseResourceText('Iron ore :80 (-2, 4); 75 (5, 6)')).toEqual([
      testNode('iron-ore', -2, 4, 80),
      testNode('iron-ore', 5, 6, 75)
    ]);
    expect(parseResourceText('Stone: 80 (1, 2)')).toEqual([testNode('boulder', 1, 2, 80)]);
  });

  it('persists nodes independently and rejects invalid stored data without overwriting it', () => {
    const key = `${RESOURCE_STORAGE_KEY}.unit`;
    localStorage.removeItem(key);
    try {
      const repository = new ResourceRepository(localStorage, key);
      const node = testNode('iron-ore', -12, 4, 77);
      repository.save([node]);
      expect(new ResourceRepository(localStorage, key).list()).toEqual([node]);

      localStorage.setItem(key, '{broken');
      expect(() => repository.save([testNode('sand', 1, 2)])).toThrowError('Saved resources are not valid JSON.');
      expect(() => repository.list()).toThrowError('Saved resources are not valid JSON.');
      expect(localStorage.getItem(key)).toBe('{broken');
    } finally { localStorage.removeItem(key); }
  });

  it('validates a full share code before merging and never overwrites existing nodes', () => {
    const key = `${RESOURCE_STORAGE_KEY}.merge`;
    localStorage.removeItem(key);
    try {
      const repository = new ResourceRepository(localStorage, key);
      const saved = testNode('hardwood', 1, 2, 45);
      const importedConflict = testNode('hardwood', 1, 2, 99);
      const added = testNode('softwood', -3, 5, 88);
      repository.save([saved]);
      const code = createResourceShareCode([importedConflict, added]);
      expect(repository.mergeShareCode(code)).toEqual({ added: 1, existing: 1 });
      expect(repository.list()).toEqual([saved, added]);

      const before = localStorage.getItem(key);
      expect(() => repository.mergeShareCode('res1.not-valid!')).toThrowError('The resource import code is malformed.');
      expect(localStorage.getItem(key)).toBe(before);
      expect(() => decodeResourceShareCode('old-code')).toThrowError('This is not a supported resource import code.');
    } finally { localStorage.removeItem(key); }
  });

  it('encodes and decodes versioned, validated share codes', () => {
    const nodes = [testNode('clay', 7, -9, 1), testNode('silver-ore', 11, 0, 100)];
    expect(decodeResourceShareCode(createResourceShareCode(nodes))).toEqual(nodes);
    expect(() => createResourceShareCode([])).toThrowError('Select at least one resource to share.');
  });

  it('parses whitespace and CSV imports, including headers, aliases, and default quality', () => {
    expect(parseResourceText('Hardwood -4 9\nOak 5 -2 73')).toEqual([
      testNode('hardwood', -4, 9),
      testNode('hardwood', 5, -2, 73)
    ]);
    expect(parseResourceText('quality,r,resource,q\n88,7,Iron ore,-3\n,2,Pine,4')).toEqual([
      testNode('iron-ore', -3, 7, 88),
      testNode('softwood', 4, 2)
    ]);
    expect(parseResourceText('resource,q,r\n"Granite outcrop",-6,11')).toEqual([
      testNode('granite-outcrop', -6, 11)
    ]);
  });

  it('rejects invalid raw rows with their line number before any merge is written', () => {
    const key = `${RESOURCE_STORAGE_KEY}.raw-invalid`;
    const saved = testNode('hardwood', 1, 2, 40);
    localStorage.removeItem(key);
    try {
      const repository = new ResourceRepository(localStorage, key);
      repository.save([saved]);
      const before = localStorage.getItem(key);
      expect(() => repository.mergeNodes(parseResourceText('Clay 8 9\nUnknown resource 10 11')))
        .toThrowError('Line 2: unknown resource type.');
      expect(localStorage.getItem(key)).toBe(before);
      expect(() => parseResourceText('Clay 1 2 101')).toThrowError('Line 1: quality must be from 1 to 100.');
      expect(() => parseResourceText('Clay 1.5 2')).toThrowError('Line 1: q and r must be whole numbers.');
      expect(() => parseResourceText('Flint 80 (-2, 4)\nFlint 101 (5, 6)'))
        .toThrowError('Line 2: quality must be from 1 to 100.');
      expect(() => parseResourceText('Flint 80 (1.5, 2)'))
        .toThrowError('Line 1: grouped coordinates must use (q, r) pairs separated by commas.');
      expect(() => parseResourceText('Flint 80 (1, 2),'))
        .toThrowError('Line 1: each quality group needs at least one (q, r) coordinate.');
      expect(() => parseResourceText('Clay: 101 (1, 2)'))
        .toThrowError('Line 1: quality must be from 1 to 100.');
    } finally { localStorage.removeItem(key); }
  });

  it('merges repeated raw nodes without overwriting existing qualities', () => {
    const key = `${RESOURCE_STORAGE_KEY}.raw-merge`;
    const saved = testNode('copper-ore', 1, 2, 40);
    const added = testNode('boulder', -3, 5, 88);
    localStorage.removeItem(key);
    try {
      const repository = new ResourceRepository(localStorage, key);
      repository.save([saved]);
      const imported = parseResourceText('Copper 1 2 99\nCopper ore 1 2 70\nStone -3 5 88\nBoulder -3 5 99');
      expect(repository.mergeNodes(imported)).toEqual({ added: 1, existing: 3 });
      expect(repository.list()).toEqual([saved, added]);
    } finally { localStorage.removeItem(key); }
  });
});

describe('resource routes', () => {
  it('immediately provides a complete route for twenty targets before exact search finishes', () => {
    const nodes = Array.from({ length: 20 }, (_, i) => testNode('clay', i * 19 - 180, (i * 43 % 251) - 125));
    for (const usePortals of [false, true]) {
      const search = new OptimalRouteSearch(nodes, { q: 0, r: 0 }, usePortals);
      expect(search.done).toBeFalse();
      expect(search.optimal).toBeFalse();
      expect(search.result?.stops.length).toBe(20);
      expect(search.result?.stops.map(stop => stop.node)).toEqual(jasmine.arrayWithExactContents(nodes));
      expect(search.result?.stops.reduce((sum, stop) => sum + stop.distanceFromPrevious, 0))
        .toBe(search.result?.totalDistance);
      search.cancel();
      expect(search.result?.stops.length).toBe(20);
      expect(search.optimal).toBeFalse();
    }
  });

  it('improves the provisional route during exact search and only then marks it optimal', () => {
    const nodes = [[10, -21], [-9, -1], [2, -19], [-23, -19], [-25, 21], [12, 2], [24, -1]]
      .map(([q, r]) => testNode('clay', q, r));
    const search = new OptimalRouteSearch(nodes, { q: 0, r: 0 }, false);
    expect(search.result?.totalDistance).toBe(152);
    expect(search.optimal).toBeFalse();
    completeRoute(search);
    expect(search.result?.totalDistance).toBe(142);
    expect(search.optimal).toBeTrue();
  });

  it('uses A* to prove a twenty-target route within the safety limits', () => {
    const nodes = Array.from({ length: 20 }, (_, i) => testNode('clay', i * 19 - 180, (i * 43 % 251) - 125));
    const search = new OptimalRouteSearch(nodes, { q: 0, r: 0 }, false);
    const initialDistance = search.result!.totalDistance;
    completeRoute(search);
    expect(search.error).toBe('');
    expect(search.optimal).toBeTrue();
    expect(search.result!.stops.length).toBe(20);
    expect(search.result!.totalDistance).toBeLessThanOrEqual(initialDistance);
  });

  it('uses axial hex distance and computes an exact open route distance', () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 5, r: 2 })).toBe(7);
    const route = completeRoute(new OptimalRouteSearch([testNode('iron-ore', 5, 2)], { q: 0, r: 0 }, false));
    expect(route?.totalDistance).toBe(7);
    expect(route?.stops[0].distanceFromPrevious).toBe(7);
    expect(route?.stops.map(stop => stop.node.type)).toEqual(['iron-ore']);
  });

  it('finds a shorter open route than nearest-next greedy ordering', () => {
    const nodes = [
      testNode('hardwood', -3, -3),
      testNode('softwood', -3, -2),
      testNode('clay', 2, 3)
    ];
    const route = completeRoute(new OptimalRouteSearch(nodes, { q: 0, r: 0 }, false));
    expect(route?.totalDistance).toBe(16);
    expect(route?.stops.map(stop => stop.node.type)).toEqual(['clay', 'softwood', 'hardwood']);
  });

  it('uses global portals to minimize walking distance without estimating cooldown timing', () => {
    const portals = [0, 1000, 2000, 3000].map(q => ({ name: `P${q}`, q, r: 0 }));
    const nodes = [testNode('hardwood', 1000, 0), testNode('softwood', 2000, 0), testNode('clay', 3000, 0)];
    const route = completeRoute(new OptimalRouteSearch(nodes, { q: 0, r: 0 }, true, portals));
    expect(route?.totalDistance).toBe(0);
    expect(route?.portals.length).toBe(3);
    expect(route?.stops.map(stop => stop.distanceFromPrevious)).toEqual([0, 0, 0]);
    expect(route?.portals.map(portal => [portal.from.name, portal.to.name])).toEqual([
      ['P0', 'P1000'], ['P1000', 'P2000'], ['P2000', 'P3000']
    ]);
  });

  it('prefers fewer portal uses when walking distance ties', () => {
    const portals = [
      { name: 'North', q: 1, r: 0 },
      { name: 'East', q: 0, r: 1 }
    ];
    const route = completeRoute(new OptimalRouteSearch([testNode('clay', 5, 2)], { q: 0, r: 0 }, true, portals));
    expect(route?.totalDistance).toBe(7);
    expect(route?.portals).toEqual([]);
  });

  it('matches an independent exhaustive route reference with duplicate portals and disabled portals', () => {
    const portals = [
      { name: 'Origin first', q: 0, r: 0 },
      { name: 'Origin duplicate', q: 0, r: 0 },
      { name: 'Middle', q: 10, r: 0 },
      { name: 'Destination', q: 20, r: 0 }
    ];
    const scenarios = [
      {
        nodes: [testNode('hardwood', 10, 0), testNode('softwood', 20, 0), testNode('clay', 30, 0)],
        start: { q: 0, r: 0 },
        usePortals: true
      },
      {
        nodes: [testNode('hardwood', 4, 2), testNode('softwood', -7, 3), testNode('clay', 9, -5)],
        start: { q: -2, r: -1 },
        usePortals: false
      }
    ];

    for (const scenario of scenarios) {
      const route = completeRoute(new OptimalRouteSearch(scenario.nodes, scenario.start, scenario.usePortals, portals))!;
      const reference = referenceRouteScore(scenario.nodes, scenario.start, scenario.usePortals ? portals : []);
      expect({ totalDistance: route.totalDistance, portalCount: route.portals.length }).toEqual(reference);
      expect(route.stops.reduce((sum, stop) => sum + stop.distanceFromPrevious, 0)).toBe(route.totalDistance);
      if (!scenario.usePortals) expect(route.portals).toEqual([]);
      for (const portal of route.portals) {
        expect(portal.from.q !== portal.to.q || portal.from.r !== portal.to.r).toBeTrue();
      }
    }
  });

  it('matches exhaustive routes across seeded scenarios, including portal-count ties', () => {
    let seed = 314159;
    const coordinate = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed % 31 - 15;
    };
    const portals = [
      { name: 'A', q: -10, r: 0 }, { name: 'B', q: 10, r: 0 }, { name: 'C', q: 0, r: 10 }
    ];
    for (let scenario = 0; scenario < 12; scenario++) {
      const nodes = Array.from({ length: 6 }, () => testNode('clay', coordinate(), coordinate()));
      const start = { q: coordinate(), r: coordinate() };
      const usePortals = scenario % 2 === 0;
      const search = new OptimalRouteSearch(nodes, start, usePortals, portals);
      const route = completeRoute(search)!;
      expect(search.optimal).toBeTrue();
      expect({ totalDistance: route.totalDistance, portalCount: route.portals.length })
        .toEqual(referenceRouteScore(nodes, start, usePortals ? portals : []));
    }
  });

  it('returns an empty route and rejects invalid starts, targets, portals, and oversized selections', () => {
    const empty = new OptimalRouteSearch([], { q: 0, r: 0 }, false);
    expect(empty.done).toBeTrue();
    expect(empty.result).toEqual({ totalDistance: 0, stops: [], portals: [] });
    expect(() => new OptimalRouteSearch([], { q: 0.5, r: 0 }, false)).toThrowError('Starting coordinates must be whole numbers.');
    expect(() => new OptimalRouteSearch([testNode('clay', 0, 0, 101)], { q: 0, r: 0 }, false))
      .toThrowError('Route targets are invalid.');
    expect(() => new OptimalRouteSearch([testNode('clay', 0, 0)], { q: 0, r: 0 }, true, [{ name: 'Bad', q: 0.5, r: 0 }]))
      .toThrowError('Portal coordinates must be whole numbers.');
    expect(() => new OptimalRouteSearch(
      Array.from({ length: 21 }, (_, index) => testNode('sand', index, 0)),
      { q: 0, r: 0 }, false
    )).toThrowError('Exact route search supports up to 20 selected resources.');
  });

  it('loads the provided portal catalog', () => {
    expect(PORTALS.length).toBe(16);
    expect(PORTALS.some(portal => portal.region === 'Crossways' && portal.q === -4 && portal.r === 1)).toBeTrue();
    expect(PORTALS.some(portal => portal.region === 'Feathergrass Steppe' && portal.q === -250 && portal.r === 39)).toBeTrue();
    expect(PORTALS.filter(portal => portal.address).map(portal => [portal.name, portal.address])).toEqual([
      ['Feathergrass Steppe 1', '01-08-08-06-06-11-01'],
      ['Feathergrass Steppe 2', '09-04-03-05-11-12-08'],
      ['Scorched March 1', '01-10-05-10-10-06-06'],
      ['Scorched March 2', '04-09-03-12-06-05-04'],
      ['Scorched March 3', '12-05-05-08-02-04-01'],
      ['Blackwood 1', '09-12-06-09-05-06-11'],
      ['Blackwood 2', '02-11-06-12-04-02-02'],
      ['Blackwood 3', '01-04-04-10-10-11-11'],
      ['Lakewilds 1', '03-05-05-09-07-04-09'],
      ['Lakewilds 2', '10-07-02-05-06-02-08'],
      ['Rapids', '11-03-10-11-08-03-07'],
      ['Deepmere', '07-07-06-02-11-01-05'],
      ['Manehold', '05-10-06-03-08-05-08'],
      ['Drywind', '01-04-12-09-04-06-12'],
      ['Crossways', '08-01-09-09-08-12-06']
    ]);
    const scorchedPortals = PORTALS.filter(portal => portal.region === 'Scorched March');
    expect(scorchedPortals.map(({ q, r, address, possibleAddresses }) => ({ q, r, address, possibleAddresses }))).toEqual([
      { q: 26, r: 275, address: '01-10-05-10-10-06-06', possibleAddresses: undefined },
      { q: 54, r: 238, address: '04-09-03-12-06-05-04', possibleAddresses: undefined },
      { q: 91, r: 213, address: '12-05-05-08-02-04-01', possibleAddresses: undefined }
    ]);
    const drywindCenter = { q: 36, r: 96 };
    expect(scorchedPortals.map(portal => hexDistance(drywindCenter, portal))).toEqual([179, 160, 172]);
    const matches = [
      { center: { q: -152, r: 44 }, portal: { q: -241, r: -9 }, distance: 142, address: '01-08-08-06-06-11-01' },
      { center: { q: -152, r: 44 }, portal: { q: -256, r: 17 }, distance: 131, address: '09-04-03-05-11-12-08' },
      { center: { q: -32, r: -156 }, portal: { q: 33, r: -269 }, distance: 113, address: '03-05-05-09-07-04-09' },
      { center: { q: -32, r: -156 }, portal: { q: 13, r: -261 }, distance: 105, address: '10-07-02-05-06-02-08' },
      { center: { q: 180, r: -152 }, portal: { q: 293, r: -246 }, distance: 113, address: '09-12-06-09-05-06-11' },
      { center: { q: 180, r: -152 }, portal: { q: 289, r: -255 }, distance: 109, address: '02-11-06-12-04-02-02' },
      { center: { q: 180, r: -152 }, portal: { q: 294, r: -272 }, distance: 120, address: '01-04-04-10-10-11-11' }
    ];
    for (const match of matches) {
      const portal = PORTALS.find(item => item.q === match.portal.q && item.r === match.portal.r)!;
      expect(hexDistance(match.center, portal)).toBe(match.distance);
      expect(portal.address).toBe(match.address);
      expect(portal.possibleAddresses).toBeUndefined();
    }
    const unmatched = PORTALS.find(portal => portal.name === 'Feathergrass Steppe 3')!;
    expect(unmatched.address).toBeUndefined();
    expect(unmatched.possibleAddresses).toBeUndefined();
  });

  it('carries inferred Scorched March and confirmed addresses through catalog-based route generation', () => {
    const scorchedPortals = PORTALS.filter(portal => portal.region === 'Scorched March');
    const route = completeRoute(new OptimalRouteSearch(
      [testNode('clay', scorchedPortals[1].q, scorchedPortals[1].r)],
      { q: scorchedPortals[0].q, r: scorchedPortals[0].r }, true
    ));
    expect(route?.stops[0].portal?.from.address).toBe('01-10-05-10-10-06-06');
    expect(route?.stops[0].portal?.to.address).toBe('04-09-03-12-06-05-04');

    const confirmedPortals = [PORTALS.find(portal => portal.name === 'Crossways')!, PORTALS.find(portal => portal.name === 'Rapids')!];
    const confirmedRoute = completeRoute(new OptimalRouteSearch(
      [testNode('clay', confirmedPortals[1].q, confirmedPortals[1].r)],
      { q: confirmedPortals[0].q, r: confirmedPortals[0].r }, true
    ));
    expect(confirmedRoute?.stops[0].portal?.from.address).toBe('08-01-09-09-08-12-06');
    expect(confirmedRoute?.stops[0].portal?.to.address).toBe('11-03-10-11-08-03-07');
  });

  it('preserves optional portal addresses in generated route instructions', () => {
    const portals = [
      { name: 'Entrance', q: 0, r: 0, address: 'portal://entrance-address' },
      { name: 'Exit', q: 10, r: 0, address: 'portal://exit-address' }
    ];
    const route = completeRoute(new OptimalRouteSearch([testNode('clay', 10, 0)], { q: 0, r: 0 }, true, portals));

    expect(route?.portals).toEqual([{ from: portals[0], to: portals[1] }]);
    expect(route?.stops[0].portal?.from.address).toBe('portal://entrance-address');
    expect(route?.stops[0].portal?.to.address).toBe('portal://exit-address');
  });
});