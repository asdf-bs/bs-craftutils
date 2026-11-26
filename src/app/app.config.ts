import { APP_BASE_HREF, DOCUMENT, HashLocationStrategy, LocationStrategy, PlatformLocation } from '@angular/common';
import { ApplicationConfig, Inject, Injectable, Optional, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { routes } from './app.routes';

@Injectable()
export class FileHashLocationStrategy extends HashLocationStrategy {
  constructor(
    platformLocation: PlatformLocation,
    @Optional() @Inject(APP_BASE_HREF) baseHref: string | null,
    @Inject(DOCUMENT) private readonly document: Document
  ) {
    super(platformLocation, baseHref ?? undefined);
  }

  override prepareExternalUrl(internal: string): string {
    return new URL(this.routeHash(internal), this.document.defaultView!.location.href.split('#')[0]).href;
  }

  override pushState(_state: unknown, _title: string, path: string, queryParams: string): void {
    this.document.defaultView!.location.hash = this.routeHash(path + this.normalizeQueryParams(queryParams));
  }

  override replaceState(_state: unknown, _title: string, path: string, queryParams: string): void {
    this.document.defaultView!.location.replace(this.prepareExternalUrl(path + this.normalizeQueryParams(queryParams)));
  }

  private routeHash(path: string): string {
    return `#${path.startsWith('/') ? path : `/${path}`}`;
  }

  private normalizeQueryParams(queryParams: string): string {
    if (!queryParams) return '';
    return queryParams.startsWith('?') ? queryParams : `?${queryParams}`;
  }
}

export function routerFeaturesForProtocol(protocol: string) {
  return protocol === 'file:' ? [withHashLocation()] : [];
}

export function locationStrategyProvidersForProtocol(protocol: string) {
  return protocol === 'file:' ? [{ provide: LocationStrategy, useClass: FileHashLocationStrategy }] : [];
}

const protocol = typeof document === 'undefined' ? '' : document.location.protocol;

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, ...routerFeaturesForProtocol(protocol)),
    ...locationStrategyProvidersForProtocol(protocol)
  ]
};
