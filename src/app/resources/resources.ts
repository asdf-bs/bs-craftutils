export const RESOURCE_CATALOG = [
  { id: 'hardwood', name: 'Hardwood', aliases: ['Oak'] },
  { id: 'softwood', name: 'Softwood', aliases: ['Pine'] },
  { id: 'bushes', name: 'Bushes', aliases: ['Bush'] },
  { id: 'soil', name: 'Soil', aliases: ['Dirt'] },
  { id: 'herbs', name: 'Herbs', aliases: ['Herb'] },
  { id: 'iron-ore', name: 'Iron ore', aliases: ['Iron'] },
  { id: 'copper-ore', name: 'Copper ore', aliases: ['Copper'] },
  { id: 'tin-ore', name: 'Tin ore', aliases: ['Tin'] },
  { id: 'silver-ore', name: 'Silver ore', aliases: ['Silver'] },
  { id: 'boulder', name: 'Boulder', aliases: ['Stone', 'Rock'] },
  { id: 'granite-outcrop', name: 'Granite outcrop', aliases: ['Granite'] },
  { id: 'marble-outcrop', name: 'Marble outcrop', aliases: ['Marble'] },
  { id: 'golden-shoals', name: 'Golden shoals', aliases: ['Golden shoal', 'Gold shoals', 'Gold'] },
  { id: 'clay', name: 'Clay', aliases: [] },
  { id: 'sand', name: 'Sand', aliases: [] },
  { id: 'flint', name: 'Flint', aliases: [] }
] as const;

export type ResourceType = typeof RESOURCE_CATALOG[number]['id'];
export type ResourceNode = { type: ResourceType; q: number; r: number; quality: number };
export type Coordinate = { q: number; r: number };
export type QualityBand = 'low' | 'average' | 'mid' | 'high' | 'perfect';

export const RESOURCE_STORAGE_KEY = 'craftkeeper.resources.v1';
export const PORTAL_COOLDOWN_MINUTES = 20;
export const MAX_ROUTE_TARGETS = 20;
export const MAX_ROUTE_STATES = 150_000;

export const PORTALS: ReadonlyArray<RoutePortal & { region: string }> = [
  { region: 'Feathergrass Steppe', name: 'Feathergrass Steppe 1', q: -241, r: -9, address: '01-08-08-06-06-11-01' },
  { region: 'Feathergrass Steppe', name: 'Feathergrass Steppe 2', q: -256, r: 17, address: '09-04-03-05-11-12-08' },
  { region: 'Feathergrass Steppe', name: 'Feathergrass Steppe 3', q: -250, r: 39 },
  { region: 'Scorched March', name: 'Scorched March 1', q: 26, r: 275, address: '01-10-05-10-10-06-06' },
  { region: 'Scorched March', name: 'Scorched March 2', q: 54, r: 238, address: '04-09-03-12-06-05-04' },
  { region: 'Scorched March', name: 'Scorched March 3', q: 91, r: 213, address: '12-05-05-08-02-04-01' },
  { region: 'Blackwood', name: 'Blackwood 1', q: 293, r: -246, address: '09-12-06-09-05-06-11' },
  { region: 'Blackwood', name: 'Blackwood 2', q: 289, r: -255, address: '02-11-06-12-04-02-02' },
  { region: 'Blackwood', name: 'Blackwood 3', q: 294, r: -272, address: '01-04-04-10-10-11-11' },
  { region: 'Lakewilds', name: 'Lakewilds 1', q: 33, r: -269, address: '03-05-05-09-07-04-09' },
  { region: 'Lakewilds', name: 'Lakewilds 2', q: 13, r: -261, address: '10-07-02-05-06-02-08' },
  { region: 'Rapids', name: 'Rapids', q: 176, r: -149, address: '11-03-10-11-08-03-07' },
  { region: 'Deepmere', name: 'Deepmere', q: -31, r: -153, address: '07-07-06-02-11-01-05' },
  { region: 'Manehold', name: 'Manehold', q: -149, r: 43, address: '05-10-06-03-08-05-08' },
  { region: 'Drywind', name: 'Drywind', q: 35, r: 93, address: '01-04-12-09-04-06-12' },
  { region: 'Crossways', name: 'Crossways', q: -4, r: 1, address: '08-01-09-09-08-12-06' }
];

export function isResourceType(value: unknown): value is ResourceType {
  return typeof value === 'string' && RESOURCE_CATALOG.some(resource => resource.id === value);
}

export function resourceName(type: ResourceType): string {
  return RESOURCE_CATALOG.find(resource => resource.id === type)!.name;
}

function normalizedResourceName(value: string): string {
  return value.trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
}

function resourceTypeFromName(value: string): ResourceType | null {
  const normalized = normalizedResourceName(value);
  const resource = RESOURCE_CATALOG.find(item =>
    [item.name, item.id, ...item.aliases].some(name => normalizedResourceName(name) === normalized)
  );
  return resource?.id ?? null;
}

function parseCsvFields(line: string, lineNumber: number): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (quoted) {
      if (character === '"' && line[index + 1] === '"') {
        field += '"';
        index++;
      } else if (character === '"') {
        quoted = false;
        afterQuote = true;
      } else field += character;
    } else if (character === ',') {
      fields.push(field.trim());
      field = '';
      afterQuote = false;
    } else if (afterQuote && /\s/.test(character)) {
      continue;
    } else if (character === '"' && !field.trim()) {
      field = '';
      quoted = true;
    } else if (character === '"' || afterQuote) {
      throw new Error(`Line ${lineNumber}: invalid CSV quoting.`);
    } else field += character;
  }
  if (quoted) throw new Error(`Line ${lineNumber}: invalid CSV quoting.`);
  fields.push(field.trim());
  return fields;
}

function headerColumn(field: string): 'resource' | 'q' | 'r' | 'quality' | null {
  const header = normalizedResourceName(field);
  if (['resource', 'type', 'name', 'resource name', 'resource type'].includes(header)) return 'resource';
  if (['q', 'q coordinate'].includes(header)) return 'q';
  if (['r', 'r coordinate'].includes(header)) return 'r';
  if (header === 'quality') return 'quality';
  return null;
}

function rawResourceNode(resourceNameValue: string, qValue: string, rValue: string, qualityValue: string | undefined, lineNumber: number): ResourceNode {
  const type = resourceTypeFromName(resourceNameValue);
  if (!type) throw new Error(`Line ${lineNumber}: unknown resource type.`);
  if (!/^-?\d+$/.test(qValue.trim()) || !/^-?\d+$/.test(rValue.trim())) {
    throw new Error(`Line ${lineNumber}: q and r must be whole numbers.`);
  }
  const q = Number(qValue);
  const r = Number(rValue);
  if (!Number.isSafeInteger(q) || !Number.isSafeInteger(r)) {
    throw new Error(`Line ${lineNumber}: q and r must be safe whole numbers.`);
  }
  let quality = 100;
  if (qualityValue?.trim()) {
    if (!/^-?\d+$/.test(qualityValue.trim())) throw new Error(`Line ${lineNumber}: quality must be a whole number from 1 to 100.`);
    quality = Number(qualityValue);
  }
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new Error(`Line ${lineNumber}: quality must be from 1 to 100.`);
  }
  return { type, q, r, quality };
}

function parseGroupedHeader(firstGroup: string, lineNumber: number): { resource: string; quality: string; coordinates: string } {
  const resourceNames = RESOURCE_CATALOG.flatMap(resource => [resource.name, resource.id, ...resource.aliases])
    .sort((left, right) => right.length - left.length);
  for (const resource of resourceNames) {
    const escaped = resource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = firstGroup.match(new RegExp(`^(${escaped})(?:\\s*:\\s*|\\s+)(\\S+)\\s+(.+)$`, 'i'));
    if (match) return { resource: match[1], quality: match[2], coordinates: match[3] };
  }

  const fallback = firstGroup.match(/^(.+?)\s*:\s*(\S+)\s+(.+)$/) ?? firstGroup.match(/^(.+?)\s+(\S+)\s+(.+)$/);
  if (fallback) return { resource: fallback[1], quality: fallback[2], coordinates: fallback[3] };
  throw new Error(`Line ${lineNumber}: use "resource quality (q, r), ...; quality (q, r)".`);
}

export function parseResourceText(text: string): ResourceNode[] {
  const lines = text.split(/\r?\n/).map((value, index) => ({ value: value.trim(), number: index + 1 }))
    .filter(line => line.value.length > 0);
  if (!lines.length) throw new Error('Enter at least one resource to import.');

  const firstFields = lines[0].value.includes(',') ? parseCsvFields(lines[0].value, lines[0].number) : [];
  const columns = firstFields.map(headerColumn);
  const hasHeader = columns.some(column => column !== null);
  if (hasHeader) {
    const indexOf = (column: 'resource' | 'q' | 'r' | 'quality'): number => columns.indexOf(column);
    const resource = indexOf('resource');
    const q = indexOf('q');
    const r = indexOf('r');
    const quality = indexOf('quality');
    if (resource < 0 || q < 0 || r < 0 || new Set(columns.filter(column => column !== null)).size !== columns.filter(column => column !== null).length) {
      throw new Error(`Line ${lines[0].number}: CSV header must include unique resource, q, and r columns.`);
    }
    const rowLines = lines.slice(1);
    if (!rowLines.length) throw new Error('The CSV file does not contain any resource rows.');
    return rowLines.map(line => {
      const fields = parseCsvFields(line.value, line.number);
      const field = (index: number): string | undefined => index < 0 ? undefined : fields[index];
      return rawResourceNode(field(resource) ?? '', field(q) ?? '', field(r) ?? '', field(quality), line.number);
    });
  }

  return lines.flatMap(line => {
    if (/[();]/.test(line.value)) {
      const groups = line.value.split(';');
      const firstGroup = groups.shift()!;
      const first = parseGroupedHeader(firstGroup, line.number);
      const resource = first.resource;
      const qualityGroups = [{ quality: first.quality, coordinates: first.coordinates }, ...groups.map(group => {
        const match = group.trim().match(/^(\S+)\s+(.+)$/);
        if (!match) throw new Error(`Line ${line.number}: use "resource quality (q, r), ...; quality (q, r)".`);
        return { quality: match[1], coordinates: match[2] };
      })];
      const nodes: ResourceNode[] = [];
      for (const group of qualityGroups) {
        let remaining = group.coordinates.trim();
        if (!remaining) throw new Error(`Line ${line.number}: each quality group needs at least one (q, r) coordinate.`);
        while (remaining) {
          const coordinate = remaining.match(/^\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)(.*)$/);
          if (!coordinate) throw new Error(`Line ${line.number}: grouped coordinates must use (q, r) pairs separated by commas.`);
          nodes.push(rawResourceNode(resource, coordinate[1], coordinate[2], group.quality, line.number));
          remaining = coordinate[3].trim();
          if (remaining) {
            if (!remaining.startsWith(',')) throw new Error(`Line ${line.number}: grouped coordinates must use (q, r) pairs separated by commas.`);
            remaining = remaining.slice(1).trim();
            if (!remaining) throw new Error(`Line ${line.number}: each quality group needs at least one (q, r) coordinate.`);
          }
        }
      }
      return nodes;
    }

    if (line.value.includes(',')) {
      const fields = parseCsvFields(line.value, line.number);
      if (fields.length < 3 || fields.length > 4) {
        throw new Error(`Line ${line.number}: CSV rows need resource, q, r, and optional quality columns.`);
      }
      return [rawResourceNode(fields[0], fields[1], fields[2], fields[3], line.number)];
    }
    const match = line.value.match(/^(.+?)\s+(-?\d+)\s+(-?\d+)(?:\s+(-?\d+))?$/) ??
      line.value.match(/^(.+?)\s+(\S+)\s+(\S+)(?:\s+(\S+))?$/);
    if (!match) throw new Error(`Line ${line.number}: use "resource name q r [quality]".`);
    return [rawResourceNode(match[1], match[2], match[3], match[4], line.number)];
  });
}

export function resourceKey(node: Pick<ResourceNode, 'type' | 'q' | 'r'>): string {
  return `${node.type}:${node.q}:${node.r}`;
}

export function qualityBand(quality: number): QualityBand {
  if (quality < 30) return 'low';
  if (quality < 60) return 'average';
  if (quality < 90) return 'mid';
  if (quality < 100) return 'high';
  return 'perfect';
}

export function validateResourceNode(value: unknown): value is ResourceNode {
  if (!value || typeof value !== 'object') return false;
  const node = value as Record<string, unknown>;
  return isResourceType(node['type']) && Number.isSafeInteger(node['q']) && Number.isSafeInteger(node['r']) &&
    Number.isInteger(node['quality']) && (node['quality'] as number) >= 1 && (node['quality'] as number) <= 100;
}

function validateNodeList(value: unknown): ResourceNode[] {
  if (!Array.isArray(value) || !value.every(validateResourceNode)) throw new Error('Resource data is not valid.');
  const seen = new Set<string>();
  for (const node of value) {
    const key = resourceKey(node);
    if (seen.has(key)) throw new Error('Resource data contains duplicate nodes.');
    seen.add(key);
  }
  return value.map(node => ({ ...node }));
}

export class ResourceRepository {
  constructor(private readonly storage: Storage = localStorage, private readonly key = RESOURCE_STORAGE_KEY) {}

  list(): ResourceNode[] {
    const saved = this.storage.getItem(this.key);
    if (saved === null) return [];
    let parsed: unknown;
    try { parsed = JSON.parse(saved); }
    catch { throw new Error('Saved resources are not valid JSON.'); }
    return validateNodeList(parsed);
  }

  save(nodes: ResourceNode[]): void {
    this.list();
    const validated = validateNodeList(nodes);
    this.storage.setItem(this.key, JSON.stringify(validated));
  }

  mergeShareCode(code: string): { added: number; existing: number } {
    return this.mergeNodes(decodeResourceShareCode(code));
  }

  mergeNodes(nodes: ResourceNode[]): { added: number; existing: number } {
    if (!Array.isArray(nodes) || !nodes.every(validateResourceNode)) throw new Error('Resource data is not valid.');
    const imported = nodes.map(node => ({ ...node }));
    const current = this.list();
    const keys = new Set(current.map(resourceKey));
    let added = 0;
    for (const node of imported) {
      const key = resourceKey(node);
      if (keys.has(key)) continue;
      keys.add(key);
      current.push(node);
      added++;
    }
    if (added) this.save(current);
    return { added, existing: imported.length - added };
  }
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function createResourceShareCode(nodes: ResourceNode[]): string {
  const validated = validateNodeList(nodes);
  if (!validated.length) throw new Error('Select at least one resource to share.');
  return `res1.${encodeBase64Url(JSON.stringify({ version: 1, nodes: validated }))}`;
}

export function decodeResourceShareCode(code: string): ResourceNode[] {
  const [prefix, payload, ...extra] = code.trim().split('.');
  if (prefix !== 'res1' || !payload || extra.length) throw new Error('This is not a supported resource import code.');
  let parsed: unknown;
  try { parsed = JSON.parse(decodeBase64Url(payload)); }
  catch { throw new Error('The resource import code is malformed.'); }
  if (!parsed || typeof parsed !== 'object' || (parsed as Record<string, unknown>)['version'] !== 1) {
    throw new Error('The resource import code has an unsupported version.');
  }
  return validateNodeList((parsed as Record<string, unknown>)['nodes']);
}

export function hexDistance(a: Coordinate, b: Coordinate): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

export type RoutePortal = {
  name: string;
  q: number;
  r: number;
  region?: string;
  address?: string;
  possibleAddresses?: readonly string[];
};
export type PortalUse = { from: RoutePortal; to: RoutePortal };
export type RouteStop = { node: ResourceNode; distanceFromPrevious: number; portal?: PortalUse };
export type OptimalRoute = { totalDistance: number; stops: RouteStop[]; portals: PortalUse[] };

function bitCount(mask: number): number {
  let count = 0;
  for (; mask; mask &= mask - 1) count++;
  return count;
}

type RouteTransition = { stop: RouteStop };
type RouteLeg = { distanceFromPrevious: number; portal?: PortalUse };
type RouteScore = { distance: number; portalCount: number };
type RouteState = {
  mask: number;
  lastIndex: number;
  distance: number;
  portalCount: number;
  estimatedDistance: number;
  sequence: number;
  parent: RouteState | null;
  transition: RouteTransition | null;
  active: boolean;
};

export class OptimalRouteSearch {
  private readonly fullMask: number;
  private readonly queue: RouteState[] = [];
  private readonly frontiers = new Map<string, RouteState>();
  private readonly mstCache = new Map<number, number>([[0, 0]]);
  private nextSequence = 0;
  private expanded = 0;
  private _result: OptimalRoute | null = null;
  private _error = '';
  private _done: boolean;
  private _optimal = false;
  private readonly legs: RouteLeg[][];

  constructor(
    private readonly nodes: ResourceNode[],
    private readonly start: Coordinate,
    private readonly usePortals: boolean,
    portals: ReadonlyArray<RoutePortal> = PORTALS
  ) {
    if (nodes.length > MAX_ROUTE_TARGETS) throw new Error(`Exact route search supports up to ${MAX_ROUTE_TARGETS} selected resources.`);
    if (!Number.isSafeInteger(start.q) || !Number.isSafeInteger(start.r)) throw new Error('Starting coordinates must be whole numbers.');
    if (nodes.some(node => !validateResourceNode(node))) throw new Error('Route targets are invalid.');
    this.portals = portals.map(portal => ({ ...portal }));
    if (this.portals.some(portal => !Number.isSafeInteger(portal.q) || !Number.isSafeInteger(portal.r))) {
      throw new Error('Portal coordinates must be whole numbers.');
    }
    this.legs = this.buildLegs();
    this.fullMask = (1 << nodes.length) - 1;
    this._done = nodes.length === 0;
    this._result = this.initialRoute();
    const initial: RouteState = {
      mask: 0, lastIndex: -1, distance: 0, portalCount: 0,
      estimatedDistance: this.estimateRemaining(0, -1), sequence: this.nextSequence++,
      parent: null, transition: null, active: true
    };
    if (!this._done) this.enqueue(initial);
    else this._optimal = true;
  }

  private readonly portals: RoutePortal[];

  private buildLegs(): RouteLeg[][] {
    const locations = [this.start, ...this.nodes];
    const portalDistances = locations.map(location => this.portals.map(portal => hexDistance(location, portal)));
    return locations.map((source, sourceIndex) => this.nodes.map((target, targetIndex) => {
      let best: RouteLeg = { distanceFromPrevious: hexDistance(source, target) };
      if (!this.usePortals) return best;
      for (let fromIndex = 0; fromIndex < this.portals.length; fromIndex++) {
        const from = this.portals[fromIndex];
        for (let toIndex = 0; toIndex < this.portals.length; toIndex++) {
          const to = this.portals[toIndex];
          if (from.q === to.q && from.r === to.r) continue;
          const distanceFromPrevious = portalDistances[sourceIndex][fromIndex] + portalDistances[targetIndex + 1][toIndex];
          if (distanceFromPrevious < best.distanceFromPrevious) {
            best = { distanceFromPrevious, portal: { from, to } };
          }
        }
      }
      return best;
    }));
  }

  private initialRoute(): OptimalRoute {
    if (!this.nodes.length) return { totalDistance: 0, stops: [], portals: [] };
    let bestOrder: number[] = [];
    let bestScore: RouteScore = { distance: Infinity, portalCount: Infinity };
    for (let first = 0; first < this.nodes.length; first++) {
      const order = [first];
      const remaining = new Set(this.nodes.map((_, index) => index));
      remaining.delete(first);
      while (remaining.size) {
        const source = order[order.length - 1];
        let next = -1;
        for (const index of remaining) {
          const leg = this.legs[source + 1][index];
          const bestLeg = next < 0 ? null : this.legs[source + 1][next];
          if (!bestLeg || this.compare(
            { distance: leg.distanceFromPrevious, portalCount: leg.portal ? 1 : 0 },
            { distance: bestLeg.distanceFromPrevious, portalCount: bestLeg.portal ? 1 : 0 }
          ) < 0) next = index;
        }
        order.push(next);
        remaining.delete(next);
      }
      const score = this.scoreOrder(order);
      if (this.compare(score, bestScore) < 0) {
        bestOrder = order;
        bestScore = score;
      }
    }
    for (let pass = 0; pass < 4; pass++) {
      let improved = false;
      for (let from = 0; from < bestOrder.length - 1; from++) {
        for (let to = from + 1; to < bestOrder.length; to++) {
          const candidate = [...bestOrder];
          candidate.splice(from, to - from + 1, ...candidate.slice(from, to + 1).reverse());
          const score = this.scoreOrder(candidate);
          if (this.compare(score, bestScore) < 0) {
            bestOrder = candidate;
            bestScore = score;
            improved = true;
          }
        }
      }
      if (!improved) break;
    }
    const stops: RouteStop[] = [];
    let source = -1;
    for (const index of bestOrder) {
      const leg = this.legs[source + 1][index];
      stops.push({ node: this.nodes[index], ...leg });
      source = index;
    }
    return { totalDistance: bestScore.distance, stops, portals: stops.flatMap(stop => stop.portal ? [stop.portal] : []) };
  }

  private scoreOrder(order: number[]): RouteScore {
    let distance = 0;
    let portalCount = 0;
    let source = -1;
    for (const index of order) {
      const leg = this.legs[source + 1][index];
      distance += leg.distanceFromPrevious;
      if (leg.portal) portalCount++;
      source = index;
    }
    return { distance, portalCount };
  }

  get done(): boolean { return this._done; }
  get result(): OptimalRoute | null { return this._result; }
  get error(): string { return this._error; }
  get optimal(): boolean { return this._optimal; }

  cancel(): void {
    if (this._done) return;
    this._done = true;
    this.queue.length = 0;
    this.frontiers.clear();
  }

  processNext(maxStates = 1): boolean {
    if (this._done) return true;
    for (let count = 0; count < maxStates && this.queue.length; count++) {
      const state = this.pop()!;
      if (!state.active) continue;
      this.expanded++;
      if (this.expanded > MAX_ROUTE_STATES) {
        this.stopAtLimit(`Exact search exceeded ${MAX_ROUTE_STATES.toLocaleString()} processed states.`);
        return true;
      }
      if (this.compare(
        { distance: state.estimatedDistance, portalCount: state.portalCount },
        this.resultScore()
      ) >= 0) continue;
      this.expand(state);
      if (this._done) return true;
    }
    if (!this.queue.length) {
      this._done = true;
      this._optimal = true;
      this.frontiers.clear();
    }
    return this._done;
  }

  private expand(state: RouteState): void {
    for (let index = 0; index < this.nodes.length; index++) {
      const bit = 1 << index;
      if (state.mask & bit) continue;
      const leg = this.legs[state.lastIndex + 1][index];
      this.enqueueTransition(state, index, leg.distanceFromPrevious, leg.portal);
      if (this._done) return;
    }
  }

  private enqueueTransition(state: RouteState, index: number, distanceFromPrevious: number, portal?: PortalUse): void {
    const mask = state.mask | (1 << index);
    const key = `${mask}:${index}`;
    const distance = state.distance + distanceFromPrevious;
    const portalCount = state.portalCount + (portal ? 1 : 0);
    if (mask === this.fullMask) {
      if (this.compare({ distance, portalCount }, this.resultScore()) < 0) {
        const final: RouteState = {
          mask, lastIndex: index, distance, portalCount,
          estimatedDistance: distance, sequence: this.nextSequence++,
          parent: state,
          transition: { stop: { node: this.nodes[index], distanceFromPrevious, ...(portal ? { portal } : {}) } },
          active: true
        };
        this._result = this.buildResult(final);
      }
      return;
    }
    const estimatedDistance = distance + this.estimateRemaining(mask, index);
    if (this.compare({ distance: estimatedDistance, portalCount }, this.resultScore()) >= 0) return;
    const previous = this.frontiers.get(key);
    if (previous && this.compare(previous, { distance, portalCount }) <= 0) return;
    const next: RouteState = {
      mask, lastIndex: index, distance, portalCount, estimatedDistance, sequence: this.nextSequence++,
      parent: state,
      transition: { stop: { node: this.nodes[index], distanceFromPrevious, ...(portal ? { portal } : {}) } },
      active: true
    };
    if (this.queue.length >= MAX_ROUTE_STATES * 2) {
      this.stopAtLimit(`Exact search exceeded ${(MAX_ROUTE_STATES * 2).toLocaleString()} queued states.`);
      return;
    }
    if (previous) previous.active = false;
    this.frontiers.set(key, next);
    this.push(next);
  }

  private estimateRemaining(mask: number, lastIndex: number): number {
    const remaining = this.fullMask ^ mask;
    if (!remaining) return 0;
    let nearest = Infinity;
    for (let index = 0; index < this.nodes.length; index++) {
      if (remaining & (1 << index)) {
        nearest = Math.min(nearest, this.legs[lastIndex + 1][index].distanceFromPrevious);
      }
    }
    return nearest + this.minimumSpanningTree(remaining);
  }

  private minimumSpanningTree(mask: number): number {
    const cached = this.mstCache.get(mask);
    if (cached !== undefined) return cached;
    const first = 31 - Math.clz32(mask);
    const included = new Set<number>([first]);
    const cheapest = new Map<number, number>();
    for (let index = 0; index < this.nodes.length; index++) {
      if (mask & (1 << index) && index !== first) cheapest.set(index, this.minimumPairDistance(first, index));
    }
    let total = 0;
    const targetCount = bitCount(mask);
    while (included.size < targetCount) {
      let next = -1;
      let nextDistance = Infinity;
      for (const [index, distance] of cheapest) {
        if (!included.has(index) && distance < nextDistance) {
          next = index;
          nextDistance = distance;
        }
      }
      if (next < 0) break;
      total += nextDistance;
      included.add(next);
      for (const index of cheapest.keys()) {
        if (!included.has(index)) {
          cheapest.set(index, Math.min(cheapest.get(index)!, this.minimumPairDistance(next, index)));
        }
      }
    }
    this.mstCache.set(mask, total);
    return total;
  }

  private minimumPairDistance(first: number, second: number): number {
    return Math.min(
      this.legs[first + 1][second].distanceFromPrevious,
      this.legs[second + 1][first].distanceFromPrevious
    );
  }

  private push(state: RouteState): void {
    let index = this.queue.length;
    this.queue.push(state);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.comparePriority(this.queue[parent], state) <= 0) break;
      this.queue[index] = this.queue[parent];
      index = parent;
    }
    this.queue[index] = state;
  }

  private pop(): RouteState | undefined {
    const first = this.queue[0];
    const last = this.queue.pop();
    if (!this.queue.length || !last) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.queue.length) break;
      let child = left;
      if (right < this.queue.length && this.comparePriority(this.queue[right], this.queue[left]) < 0) child = right;
      if (this.comparePriority(last, this.queue[child]) <= 0) break;
      this.queue[index] = this.queue[child];
      index = child;
    }
    this.queue[index] = last;
    return first;
  }

  private comparePriority(a: RouteState, b: RouteState): number {
    return a.estimatedDistance - b.estimatedDistance ||
      a.portalCount - b.portalCount ||
      b.distance - a.distance ||
      a.sequence - b.sequence;
  }

  private resultScore(): RouteScore {
    return { distance: this._result!.totalDistance, portalCount: this._result!.portals.length };
  }

  private stopAtLimit(message: string): void {
    this._error = message;
    this._done = true;
    this.queue.length = 0;
    this.frontiers.clear();
  }

  private enqueue(state: RouteState): void {
    this.queue.push(state);
  }

  private compare(a: Pick<RouteState, 'distance' | 'portalCount'>, b: Pick<RouteState, 'distance' | 'portalCount'>): number {
    return a.distance - b.distance || a.portalCount - b.portalCount;
  }

  private buildResult(final: RouteState): OptimalRoute {
    const transitions: RouteTransition[] = [];
    for (let state: RouteState | null = final; state?.transition; state = state.parent) transitions.push(state.transition);
    transitions.reverse();
    return {
      totalDistance: final.distance,
      stops: transitions.map(item => item.stop),
      portals: transitions.flatMap(item => item.stop.portal ? [item.stop.portal] : [])
    };
  }
}