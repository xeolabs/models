
/**
 * Supplied by the configured account, never stored in an acquisition plan or catalog.
 */
export interface SketchfabCredential {
  method: 'api-token' | 'oauth';
  token: string;
}
export type SketchfabCredentialSource = () => SketchfabCredential | undefined;
