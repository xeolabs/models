import { GitHubIFCProvider } from './GitHubIFCProvider.js';
import { ProviderHttpClient } from './ProviderHttpClient.js';

/**
 * Official buildingSMART certification datasets, covering several IFC schema versions.
 */
export class BuildingSmartProvider extends GitHubIFCProvider {
  constructor(http = new ProviderHttpClient()) {
    super(
      {
        id: 'buildingsmart',
        repository: 'buildingSMART/Certification-datasets',
        name: 'buildingSMART Certification',
        licenseFile: 'LICENSE',
      },
      http,
    );
  }
}
