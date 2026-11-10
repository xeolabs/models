# Provider accounts

Open **Provider accounts** in Models and choose **Sketchfab**. Paste an API token or an already-issued OAuth access token, then choose **Verify and save**. Models checks the account before replacing the previous configuration. A failed replacement leaves the saved account intact.

The configuration belongs to this Models server, shared by people using its library. It is saved under `<library>/.credentials/sketchfab.json`, with owner-only file permissions, and loaded before the server accepts requests. Restarting the server or reopening the app does not require entering the token again. The token is stored on the server, not in browser storage, catalog records, plans, bundles or download caches. Status responses contain only the account name, authentication method and verification time.

**Test saved connection** checks the stored token. **Disconnect** removes it from disk and disables new authenticated Sketchfab requests. It does not delete acquired models or cancel jobs; a transfer already using a signed URL can finish. Expired or revoked credentials must be replaced. This does not implement OAuth registration, browser login, or automatic token refresh.

The existing server access policy applies: configuration actions are available to clients using this trusted Models instance. Cross-origin viewer and Studio catalog access does not grant permission to change accounts. For remote access, protect the server and use HTTPS through the configured reverse proxy.

## Acquisition

Once configured, Sketchfab search cards allow selection and planning. The existing planner, job queue, transfer budget, cache, importer and provenance tracking handle downloads. Plans contain stable file identities; expiring signed URLs stay in memory. Account verification and authenticated manifests are never cached. Downloads carry no account token to the archive host.

Only documented glTF archives with CC0 or CC BY 4.0 licensing are acquired. Other licenses remain visible in search but are rejected by the existing acquisition license policy. Archives retain the existing limits: 64 entries, 512 MiB compressed/expanded total, 256 MiB per entry, and a maximum compression ratio of 200. Source-model and USDZ download options are not imported. Models can generate its usual converted formats after a successful glTF import.

## TypeScript

An embedded caller can supply credentials from its own configuration store. The server application supplies its persisted configuration automatically.

```ts
const acquisition = await library.acquisition({
  sketchfabCredential: () => ({
    method: 'api-token',
    token: process.env.SKETCHFAB_API_TOKEN!,
  }),
});
const job = await acquisition.acquire({
  provider: 'sketchfab',
  remoteId: 'your-32-character-model-id',
  resolution: 'original',
});
```

Do not include credentials in a plan or commit them to source control.
