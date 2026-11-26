import { DOCUMENT, LocationStrategy, PlatformLocation } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { appConfig, FileHashLocationStrategy, locationStrategyProvidersForProtocol, routerFeaturesForProtocol } from './app.config';
import { routes } from './app.routes';

describe('app router configuration', () => {
  it('uses hash URLs for local-file packages', () => {
    const fileLocation = { href: 'file:///package/index.html', hash: '', replace: jasmine.createSpy('replace') };
    const document = { defaultView: { location: fileLocation } } as unknown as Document;
    const platformLocation = {
      hash: '',
      onPopState: () => () => undefined,
      onHashChange: () => () => undefined
    } as unknown as PlatformLocation;
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, ...routerFeaturesForProtocol('file:')),
        ...locationStrategyProvidersForProtocol('file:'),
        { provide: PlatformLocation, useValue: platformLocation },
        { provide: DOCUMENT, useValue: document }
      ]
    });

    const strategy = TestBed.inject(LocationStrategy) as FileHashLocationStrategy;
    expect(strategy.prepareExternalUrl('/resources')).toBe('file:///package/index.html#/resources');
    strategy.pushState(null, '', '/resources', '');
    expect(fileLocation.hash).toBe('#/resources');
    strategy.replaceState(null, '', '/alchemy', '');
    expect(fileLocation.replace).toHaveBeenCalledWith('file:///package/index.html#/alchemy');
  });

  it('keeps path URLs for hosted builds', () => {
    TestBed.configureTestingModule({ providers: appConfig.providers });

    expect(routerFeaturesForProtocol('https:')).toEqual([]);
    expect(TestBed.inject(LocationStrategy).prepareExternalUrl('/resources')).toBe('/resources');
  });
});