import { Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  Coordinate,
  createResourceShareCode,
  OptimalRoute,
  OptimalRouteSearch,
  parseResourceText,
  PORTAL_COOLDOWN_MINUTES,
  PortalUse,
  QualityBand,
  qualityBand,
  RESOURCE_CATALOG,
  ResourceNode,
  ResourceRepository,
  ResourceType,
  hexDistance,
  resourceKey,
  resourceName
} from './resources';

const QUALITY_FILTERS: ReadonlyArray<{ id: QualityBand; label: string }> = [
  { id: 'low', label: 'Low · 1–29' },
  { id: 'average', label: 'Average · 30–59' },
  { id: 'mid', label: 'Mid · 60–89' },
  { id: 'high', label: 'High · 90–99' },
  { id: 'perfect', label: 'Perfect · 100' }
];

const ROUTE_BATCH_SIZE = 200;
const ROUTE_TIME_LIMIT_MS = 3000;

type RouteDisplayStep =
  | { kind: 'portal'; portal: PortalUse; distanceFromPrevious: number }
  | { kind: 'resource'; node: ResourceNode; distanceFromPrevious: number; distanceOrigin: 'starting location' | 'previous resource' | 'portal exit' };

@Component({
  selector: 'app-resources',
  imports: [FormsModule],
  templateUrl: './resources.component.html',
  styleUrl: './resources.component.css'
})
export class ResourcesComponent implements OnDestroy {
  readonly catalog = RESOURCE_CATALOG;
  readonly qualityFilters = QUALITY_FILTERS;
  readonly portalCooldownMinutes = PORTAL_COOLDOWN_MINUTES;
  readonly resourceName = resourceName;
  private readonly repository: ResourceRepository | null;
  resourceNodes: ResourceNode[] = [];
  selectedTypes = new Set<ResourceType>(RESOURCE_CATALOG.map(resource => resource.id));
  selectedBands = new Set<QualityBand>(QUALITY_FILTERS.map(filter => filter.id));
  selectedKeys = new Set<string>();
  type: ResourceType = 'hardwood';
  q: number | null = 0;
  r: number | null = 0;
  quality: number | null = 100;
  editingKey = '';
  storageError = '';
  formError = '';
  shareCode = '';
  rawResourceText = '';
  shareMessage = '';
  startQ: number | null = 0;
  startR: number | null = 0;
  usePortals = false;
  route: OptimalRoute | null = null;
  routeStatus = '';
  routeError = '';
  routeWarning = '';
  portalCopyMessage = '';
  routeOptimal = false;
  routeSnapshot: { start: Coordinate; usePortals: boolean; targetCount: number } | null = null;
  private routeSearch: OptimalRouteSearch | null = null;
  private routeTimer: ReturnType<typeof setTimeout> | null = null;
  @ViewChild('resourceTypeField') private resourceTypeField?: ElementRef<HTMLSelectElement>;
  @ViewChild('discoveredTitle') private discoveredTitle?: ElementRef<HTMLHeadingElement>;

  constructor() {
    try {
      const repository = new ResourceRepository();
      this.resourceNodes = repository.list();
      this.repository = repository;
    } catch {
      this.repository = null;
      this.storageError = 'Unable to read saved resources. Existing data has not been changed; reload after resolving the storage issue.';
    }
  }

  get filteredNodes(): ResourceNode[] {
    return this.resourceNodes.filter(node => this.selectedTypes.has(node.type) && this.selectedBands.has(qualityBand(node.quality)));
  }

  get selectedNodes(): ResourceNode[] {
    return this.resourceNodes.filter(node => this.selectedKeys.has(resourceKey(node)));
  }

  get routeSearching(): boolean {
    return this.routeSearch !== null;
  }

  get routeSteps(): RouteDisplayStep[] {
    if (!this.route) return [];
    const steps: RouteDisplayStep[] = [];
    let previousLocation = this.routeSnapshot?.start ?? { q: 0, r: 0 };
    for (const stop of this.route.stops) {
      if (stop.portal) {
        steps.push({
          kind: 'portal',
          portal: stop.portal,
          distanceFromPrevious: hexDistance(previousLocation, stop.portal.from)
        });
        steps.push({
          kind: 'resource',
          node: stop.node,
          distanceFromPrevious: hexDistance(stop.portal.to, stop.node),
          distanceOrigin: 'portal exit'
        });
      } else {
        steps.push({
          kind: 'resource',
          node: stop.node,
          distanceFromPrevious: stop.distanceFromPrevious,
          distanceOrigin: steps.length ? 'previous resource' : 'starting location'
        });
      }
      previousLocation = stop.node;
    }
    return steps;
  }

  get routeSelectionWarning(): string {
    if (this.selectedNodes.length > 12) return 'Large routes may take a few seconds. Search stops after 3 seconds; cancel any time.';
    return '';
  }

  qualityClass(node: ResourceNode): string {
    return `quality-${qualityBand(node.quality)}`;
  }

  qualityLabel(node: ResourceNode): string {
    return this.qualityFilters.find(filter => filter.id === qualityBand(node.quality))!.label.split(' · ')[0];
  }

  isSelected(node: ResourceNode): boolean {
    return this.selectedKeys.has(resourceKey(node));
  }

  toggleNode(node: ResourceNode): void {
    const key = resourceKey(node);
    if (this.selectedKeys.has(key)) this.selectedKeys.delete(key);
    else this.selectedKeys.add(key);
  }

  toggleType(type: ResourceType, checked: boolean): void {
    if (checked) this.selectedTypes.add(type);
    else this.selectedTypes.delete(type);
  }

  selectAllTypes(): void {
    this.selectedTypes = new Set(this.catalog.map(resource => resource.id));
  }

  deselectAllTypes(): void {
    this.selectedTypes.clear();
  }

  toggleBand(band: QualityBand, checked: boolean): void {
    if (checked) this.selectedBands.add(band);
    else this.selectedBands.delete(band);
  }

  selectAllBands(): void {
    this.selectedBands = new Set(this.qualityFilters.map(filter => filter.id));
  }

  deselectAllBands(): void {
    this.selectedBands.clear();
  }

  selectVisible(): void {
    for (const node of this.filteredNodes) this.selectedKeys.add(resourceKey(node));
  }

  deselectVisible(): void {
    for (const node of this.filteredNodes) this.selectedKeys.delete(resourceKey(node));
  }

  clearSelection(): void {
    this.selectedKeys.clear();
  }

  saveNode(): void {
    this.formError = '';
    if (!Number.isSafeInteger(this.q) || !Number.isSafeInteger(this.r) || !Number.isInteger(this.quality) ||
        (this.quality ?? 0) < 1 || (this.quality ?? 101) > 100) {
      this.formError = 'Enter whole-number q/r coordinates and a quality from 1 to 100.';
      return;
    }
    const node: ResourceNode = { type: this.type, q: this.q!, r: this.r!, quality: this.quality! };
    const withoutEditing = this.editingKey ? this.resourceNodes.filter(item => resourceKey(item) !== this.editingKey) : this.resourceNodes;
    if (withoutEditing.some(item => resourceKey(item) === resourceKey(node))) {
      this.formError = 'A resource of this type is already recorded at those coordinates.';
      return;
    }
    const next = [...withoutEditing, node];
    const wasSelected = !!this.editingKey && this.selectedKeys.has(this.editingKey);
    if (!this.persist(next)) return;
    this.resourceNodes = next;
    if (wasSelected) {
      this.selectedKeys.delete(this.editingKey);
      this.selectedKeys.add(resourceKey(node));
    }
    this.editingKey = '';
    this.quality = 100;
    this.formError = '';
  }

  editNode(node: ResourceNode): void {
    this.editingKey = resourceKey(node);
    this.type = node.type;
    this.q = node.q;
    this.r = node.r;
    this.quality = node.quality;
    this.formError = '';
    this.resourceTypeField?.nativeElement.focus();
  }

  cancelEdit(): void {
    this.editingKey = '';
    this.formError = '';
    this.q = 0;
    this.r = 0;
    this.quality = 100;
  }

  deleteNode(node: ResourceNode): void {
    const key = resourceKey(node);
    const next = this.resourceNodes.filter(item => resourceKey(item) !== key);
    if (!this.persist(next)) return;
    this.resourceNodes = next;
    this.selectedKeys.delete(key);
    if (this.editingKey === key) this.cancelEdit();
    this.discoveredTitle?.nativeElement.focus();
  }

  createShareCode(): void {
    this.shareMessage = '';
    try {
      this.shareCode = createResourceShareCode(this.selectedNodes);
      this.shareMessage = `${this.selectedNodes.length} selected resource${this.selectedNodes.length === 1 ? '' : 's'} ready to share.`;
    } catch (error) { this.shareMessage = this.errorMessage(error); }
  }

  importShareCode(): void {
    this.shareMessage = '';
    if (this.storageError || !this.repository) {
      this.shareMessage = this.storageError;
      return;
    }
    try {
      const result = this.repository.mergeShareCode(this.shareCode);
      this.resourceNodes = this.repository.list();
      this.shareMessage = `Imported ${result.added}; skipped ${result.existing} already saved.`;
    } catch (error) { this.shareMessage = this.errorMessage(error); }
  }

  importRawResources(): void {
    this.shareMessage = '';
    if (this.storageError || !this.repository) {
      this.shareMessage = this.storageError;
      return;
    }
    try {
      const result = this.repository.mergeNodes(parseResourceText(this.rawResourceText));
      this.resourceNodes = this.repository.list();
      this.shareMessage = `Imported ${result.added}; skipped ${result.existing} already saved.`;
    } catch (error) { this.shareMessage = this.errorMessage(error); }
  }

  async importRawFile(file: File | null): Promise<void> {
    if (!file) return;
    try {
      this.rawResourceText = await file.text();
      this.importRawResources();
    } catch (error) { this.shareMessage = this.errorMessage(error); }
  }

  generateRoute(): void {
    this.cancelRoute(false);
    this.route = null;
    this.routeSnapshot = null;
    this.routeOptimal = false;
    this.routeStatus = '';
    this.routeError = '';
    this.routeWarning = '';
    const start = this.routeCoordinate(this.startQ, this.startR);
    if (!start) {
      this.routeError = 'Enter whole-number starting coordinates.';
      return;
    }
    const nodes = this.selectedNodes.map(node => ({ ...node }));
    if (!nodes.length) {
      this.routeError = 'Select at least one resource to route.';
      return;
    }
    const usePortals = this.usePortals;
    const deadline = Date.now() + ROUTE_TIME_LIMIT_MS;
    let search: OptimalRouteSearch;
    try { search = new OptimalRouteSearch(nodes, start, usePortals); }
    catch (error) {
      this.routeError = this.errorMessage(error);
      return;
    }
    this.routeSearch = search;
    this.routeSnapshot = { start, usePortals, targetCount: nodes.length };
    this.route = search.result;
    this.routeWarning = this.routeSelectionWarning;
    if (search.done) {
      this.finishRoute(search);
      return;
    }
    this.routeStatus = 'Searching…';
    if (Date.now() >= deadline) this.stopRouteAtTimeLimit(search);
    else this.runRouteChunk(search, deadline);
  }

  cancelRoute(showMessage = true): void {
    if (this.routeTimer !== null) clearTimeout(this.routeTimer);
    this.routeTimer = null;
    const search = this.routeSearch;
    if (!search) return;
    search.cancel();
    this.route = search.result;
    this.routeOptimal = false;
    this.routeSearch = null;
    if (showMessage) this.routeStatus = 'Search cancelled.';
  }

  async copyPortalAddress(address: string, portalName: string): Promise<void> {
    this.portalCopyMessage = '';
    if (await this.copyAddress(address)) {
      this.portalCopyMessage = `Copied address for ${portalName}.`;
    } else {
      this.portalCopyMessage = `Could not copy address for ${portalName}.`;
    }
  }

  async copyPossiblePortalAddress(address: string, region: string): Promise<void> {
    this.portalCopyMessage = '';
    if (await this.copyAddress(address)) {
      this.portalCopyMessage = `Copied a possible ${region} address; portal match unknown.`;
    } else {
      this.portalCopyMessage = `Could not copy a possible ${region} address; portal match unknown.`;
    }
  }

  ngOnDestroy(): void {
    this.cancelRoute(false);
  }

  private runRouteChunk(search: OptimalRouteSearch, deadline: number): void {
    this.routeTimer = setTimeout(() => {
      if (this.routeSearch !== search) return;
      this.routeTimer = null;
      if (Date.now() >= deadline) {
        this.stopRouteAtTimeLimit(search);
        return;
      }
      const done = search.processNext(ROUTE_BATCH_SIZE);
      if (this.routeSearch !== search) return;
      this.route = search.result;
      if (done) this.finishRoute(search);
      else if (Date.now() >= deadline) this.stopRouteAtTimeLimit(search);
      else this.runRouteChunk(search, deadline);
    }, 1);
  }

  private finishRoute(search: OptimalRouteSearch): void {
    this.route = search.result;
    this.routeSearch = null;
    this.routeOptimal = !search.error && search.optimal;
    if (search.error) {
      this.routeError = search.error;
      this.routeStatus = '';
    } else if (this.routeOptimal) {
      this.routeStatus = '';
    } else {
      this.routeStatus = 'Search stopped; route may not be optimal.';
    }
  }

  private copyTextWithFallback(value: string): boolean {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try { return document.execCommand('copy'); }
    catch { return false; }
    finally { textarea.remove(); }
  }

  private async copyAddress(address: string): Promise<boolean> {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(address);
        return true;
      }
    } catch { /* Use the legacy copy fallback. */ }
    return this.copyTextWithFallback(address);
  }

  private stopRouteAtTimeLimit(search: OptimalRouteSearch): void {
    search.cancel();
    this.route = search.result;
    this.routeSearch = null;
    this.routeOptimal = false;
    this.routeStatus = 'Time limit reached.';
  }

  private routeCoordinate(q: number | null, r: number | null): Coordinate | null {
    if (!Number.isSafeInteger(q) || !Number.isSafeInteger(r)) return null;
    return { q: q!, r: r! };
  }

  private persist(nodes: ResourceNode[]): boolean {
    if (this.storageError || !this.repository) return false;
    try {
      this.repository.save(nodes);
      return true;
    } catch (error) {
      this.formError = this.errorMessage(error);
      return false;
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'The requested operation could not be completed.';
  }
}