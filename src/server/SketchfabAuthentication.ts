import { z } from 'zod';
import { ProviderHttpClient } from '../providers/ProviderHttpClient.js';
import { response } from '../providers/validation.js';
import { fail } from '../domain/ModelsError.js';
import { SketchfabConfiguration, sketchfabCredentialSchema } from './SketchfabConfiguration.js';
import type { SketchfabCredential } from '../providers/SketchfabCredential.js';

/**
 * Verify credentials before replacing the saved account. Responses expose account
 * status only; neither a browser refresh nor an API read can retrieve the token.
 */
export class SketchfabAuthentication {
  private readonly configuration: SketchfabConfiguration;
  private changing = false;
  constructor(
    root: string,
    private readonly http: ProviderHttpClient,
  ) {
    this.configuration = new SketchfabConfiguration(root);
  }
  credential(): SketchfabCredential | undefined {
    return this.configuration.credential();
  }
  status() {
    return this.configuration.status();
  }

  async connect(input: unknown) {
    const parsed = sketchfabCredentialSchema.safeParse(input);
    if (!parsed.success) fail('INVALID_PROVIDER_CREDENTIALS', 'Enter a valid Sketchfab token.');
    await this.verifyCredential(parsed.data);
    return this.status();
  }
  async verify() {
    const credential = this.credential();
    if (!credential) fail('PROVIDER_AUTH_REQUIRED', 'Configure a Sketchfab account first.');
    await this.verifyCredential(credential);
    return this.status();
  }
  private async verifyCredential(credential: SketchfabCredential) {
    // Another browser must not replace or remove the account during verification.
    if (this.changing) fail('CONFLICT', 'Sketchfab account verification is already in progress.');
    this.changing = true;
    try {
      const account = response(
        z.object({ username: z.string().min(1).max(200) }),
        await this.http.authenticatedJson(
          'sketchfab',
          'https://api.sketchfab.com/v3/me',
          `${credential.method === 'oauth' ? 'Bearer' : 'Token'} ${credential.token}`,
        ),
        'Sketchfab account response',
      );
      this.configuration.save(credential, account.username);
    } finally {
      this.changing = false;
    }
  }
  disconnect() {
    if (this.changing) fail('CONFLICT', 'Wait for Sketchfab account verification to finish.');
    this.configuration.clear();
    return this.status();
  }
}
