export const providerIds = [
  'polyhaven',
  'sketchfab',
  'smithsonian',
  'buildingsmart',
  'buildingsmart-community',
] as const;
export type ProviderId = (typeof providerIds)[number];
export interface ProviderInfo {
  id: ProviderId;
  name: string;
  acquisition: 'direct' | 'website';
  notice?: string;
}
export const providerInfo: Readonly<Record<ProviderId, ProviderInfo>> = {
  buildingsmart: {
    id: 'buildingsmart',
    name: 'buildingSMART Certification',
    acquisition: 'direct',
    notice: 'IFC certification samples. CC BY 4.0; source credits are retained.',
  },
  'buildingsmart-community': {
    id: 'buildingsmart-community',
    name: 'buildingSMART Community',
    acquisition: 'direct',
    notice:
      'Curated IFC samples: Duplex, Clinic, Esplanades and SDK S1. CC BY 4.0; these are test files, not validated production models.',
  },
  polyhaven: { id: 'polyhaven', name: 'Poly Haven', acquisition: 'direct' },
  sketchfab: {
    id: 'sketchfab',
    name: 'Sketchfab',
    acquisition: 'website',
    notice:
      'Search and compare here. Downloads require signing in on Sketchfab; direct in-app downloads are not connected.',
  },
  smithsonian: {
    id: 'smithsonian',
    name: 'Smithsonian Open Access',
    acquisition: 'direct',
    notice:
      'Open-access GLB models. Variants are provider quality labels, not texture resolutions.',
  },
};
export const acquisitionProviderIds: ProviderId[] = [
  'polyhaven',
  'smithsonian',
  'buildingsmart',
  'buildingsmart-community',
];
