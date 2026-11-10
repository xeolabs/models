import { GitHubIFCProvider } from './GitHubIFCProvider.js';
import { ProviderHttpClient } from './ProviderHttpClient.js';

/**
 * Only these reviewed collections declare CC BY 4.0 in their own notices.
 * Other folders have different or restricted terms and are deliberately excluded.
 */
export class BuildingSmartCommunityProvider extends GitHubIFCProvider {
  constructor(http = new ProviderHttpClient()) {
    super(
      {
        id: 'buildingsmart-community',
        repository: 'buildingsmart-community/Community-Sample-Test-Files',
        name: 'buildingSMART Community',
        licenseFile: 'README.md',
        folders: [
          'IFC 2.3.0.1 (IFC 2x3)/Duplex Apartment',
          'IFC 2.3.0.1 (IFC 2x3)/Medical-Dental Clinic',
          'IFC 2.3.0.1 (IFC 2x3)/Esplanades',
          'IFC 2.3.0.1 (IFC 2x3)/SDK - S1',
        ],
      },
      http,
    );
  }
}
