# Provider compatibility

Verified against Poly Haven official API documentation and live responses for `ArmChair_01` on 2026-11-09:

- [Official API specification](https://github.com/Poly-Haven/Public-API/blob/master/swagger.yml)
- [API usage terms](https://github.com/Poly-Haven/Public-API/blob/master/ToS.md)
- `GET https://api.polyhaven.com/assets?type=models`: dictionary of model metadata; client-side bounded filtering/pagination.
- `GET /info/{id}`: descriptive metadata, author, source revision and optional statistics.
- `GET /files/{id}`: format → texture resolution → format → file descriptor. Descriptors contain URL, byte size, MD5 and an optional `include` dictionary keyed by package-relative dependency paths.

The adapter acquires only asset type 2. It recognizes glTF, GLB, FBX and Blender packages, preserving every declared dependency. Dependency paths cannot be reconstructed from URLs: the real 1K ArmChair glTF references a shared `.bin` served from a different resolution directory. Paths from `include` are therefore authoritative.

Models use CC0-1.0. Attribution is retained despite CC0 not requiring it. API usage terms are separate from asset licensing. Set an identifiable `MODELS_USER_AGENT` or HTTP configuration value. Requests use pacing, bounded concurrency, conditional metadata caching, Retry-After handling and bounded retries; this is not a claim that the provider guarantees a specific public quota.

Approved file URLs are HTTPS on `dl.polyhaven.org/file/ph-assets/Models/` and `/Textures/` (model dependencies). Metadata uses `api.polyhaven.com`; previews use `cdn.polyhaven.com/asset_img/thumbs/`. Each redirect and DNS destination is checked. Downloaded originals are hashed and compared with provider checksums.

Statistics use the observed numeric `polycount` field as **provider polygons**, not a verified triangle or vertex count. `max_resolution` is documented as texture pixel dimensions. Per-package byte counts are the sum of every file descriptor; unknown sizes remain unknown. Models can report LOD availability through `attributes.lods`, which is a boolean, not an array of triangle counts. No physical-size conversion is inferred from undocumented model dimensions.

The app requests download manifests for at most 30 displayed results using two concurrent requests; it does not download geometry to estimate statistics. Size filtering requires one coherent format/resolution package satisfying all criteria. Plans preserve those constraints and exact selected files; execution never silently swaps a resolution.

ambientCG and other material-only adapters are not model providers. Additional providers can be registered through the registry when a real model API and licensing contract have been verified. No API credentials or login are required for Poly Haven or Smithsonian direct imports.

## Sketchfab

Verified the [Data API](https://docs.sketchfab.com/data-api/v3/index.html), [Download API requirements](https://sketchfab.com/developers/download-api) and [developer guidelines](https://sketchfab.com/developers/guidelines), plus live public responses on 2026-11-09.

`GET https://api.sketchfab.com/v3/search?type=models&downloadable=true&archives_flavours=true` returns cursor-based public results. The adapter sends a bounded `count` (maximum 24), query, tags and categories; it reads `cursors.next` rather than following arbitrary next URLs. `GET /v3/licenses` maps license UIDs to their real names and conditions. `GET /v3/models/{uid}` provides details. Search license references contain `uid` and `label`; the live detail response checked on 2026-11-10 instead contains `uri`, `slug`, `url`, `label`, `fullName` and `requirements`, without `uid`. Both references are matched to the same approved `/v3/licenses/{uid}` identity in the license catalog. Missing, unknown or contradictory identities are rejected. The separate search and detail fixtures preserve this distinction. Archives may be objects or arrays and include format, texture resolution, size and geometry counts. Public archive statistics are a separate presentation type, never fabricated executable download URLs.

The UI preserves actual licenses, including attribution/noncommercial/share-alike restrictions; it does not relabel everything CC0. Non-downloadable and age-restricted search results are excluded. Approved metadata host: `api.sketchfab.com/v3/`; preview host: `media.sketchfab.com/models/`.

Sketchfab downloads use the account configured in **Provider accounts**. The [Data API authentication documentation](https://docs.sketchfab.com/data-api/v3/index.html) describes API tokens (`Authorization: Token`) and OAuth access tokens (`Authorization: Bearer`). Models verifies an account with `GET /v3/me` before saving it. Public discovery remains anonymous.

The [documented download flow](https://sketchfab.com/developers/download-api/downloading-models) uses `GET /v3/models/{uid}/download`, whose `gltf` entry contains a signed `url`, archive `size` and `expires`. Models supports that glTF ZIP, with root `scene.gltf` and relative resources. It does not assume the public GLB/source/USDZ statistics are directly downloadable URLs. The approved archive host is `sketchfab-prod-media.s3.amazonaws.com`, restricted to `/archives/{uid}/gltf/`; unexpected destinations fail closed. Redirects never forward credentials across origins.

Plans retain the stable API locator and selected size, not the expiring signed URL. Account and signed-link responses bypass metadata caches. Execution revalidates metadata, licensing and size and requests a fresh link immediately before transfer. Provider `updatedAt`, when supplied, participates in plan comparison and download-cache identity. Sketchfab supplies no stable content checksum in this response; local SHA-256 verifies subsequent cache reuse but cannot establish provider-side byte immutability.

Authentication and download behavior are covered by offline fixtures based on the official API shape. No live authenticated download was tested without a user-supplied token. See [account configuration and limits](provider-accounts.md).

## Smithsonian Open Access

Verified the [official 3D API](https://3d-api.si.edu/api-docs/) and [Open Access licensing](https://www.si.edu/openaccess/faq), with live Side Chair model responses on 2026-11-09.

`GET https://3d-api.si.edu/api/v1.0/content/file/search` accepts `q`, `file_type`, `model_url`, `rows` and `start`. Responses contain `rows`, `rowCount`, titles and content descriptors. `model_url` identifies a `3d_package:<UUID>`; results are grouped by this identifier. Search is bounded to 500 file rows and detailed manifests to 500 rows. Some file pages contain many variants of the same model, so result counts are model counts, not the API's file row count.

The public 3D endpoint documents its files as Smithsonian Open Access. Direct acquisition selects self-contained GLBs explicitly marked `Download3D`; sizes come from `file_size`. Thumbnail JPGs use `Image2D`/`Thumb`. Downloads and previews stay under the verified `3d-api.si.edu/content/document/` path. No general Smithsonian API key is needed for this separate 3D endpoint.

Quality labels are preserved, with a stable URL hash suffix to distinguish multiple files sharing a label. No polygon counts or texture resolutions are inferred from filenames. The provider does not supply content checksums: plans report that limitation, and acquired bytes receive local SHA-256 hashes. Models with unknown sizes cannot pass explicit size filters; normal execution retains the conservative unknown-size policy. ZIP/OBJ/PLY and source-format Smithsonian downloads are not yet acquired automatically.

## buildingSMART IFC collections

Verified on 2026-11-10 using official GitHub metadata, repository notices and a Git LFS download response:

- [Certification datasets](https://github.com/buildingSMART/Certification-datasets), revision `80d976a9b193a26a8e928c3e79bff67af1de68a8`. Its root [LICENSE](https://github.com/buildingSMART/Certification-datasets/blob/main/LICENSE) declares CC BY 4.0. The former Sample-Test-Files URL redirects here.
- [Community samples](https://github.com/buildingsmart-community/Community-Sample-Test-Files), revision `31eb1dd0a0406fb9ebf0ebd823b48e1ec95afc08`. Discovery is limited to Duplex Apartment, Medical-Dental Clinic, Esplanades and SDK - S1, whose own README files explicitly declare CC BY 4.0. Other folders contain restricted or different licenses and are not inherited into this provider. New local LICENSE overrides cause acquisition to fail for review.

Both adapters use `GET https://api.github.com/repos/{owner}/{repo}/commits/main`, then `GET /repos/{owner}/{repo}/git/trees/{commit}?recursive=1`. Responses are validated: commit `sha`; tree `truncated`, entries `path`, `type`, `mode`, `sha`, and byte `size`. Truncated trees fail explicitly. Only regular `.ifc` files are candidates; links are excluded. Search, tags and numeric offset cursors are bounded client-side operations over the cached tree, not GitHub search API queries. Remote IDs are SHA-256 hashes of repository-relative paths, stable across revisions within a provider. The selected commit is retained separately.

Model downloads use `raw.githubusercontent.com/{owner}/{repo}/{commit}/{path}`. Small Git LFS pointer metadata is recognized by its version line, `oid sha256:<digest>` and `size <bytes>`. Its actual download uses the verified `media.githubusercontent.com/media/{owner}/{repo}/{commit}/{path}` endpoint. A live Duplex pointer declared 2,380,763 bytes; the media response returned that length and matching SHA-256 ETag. Pointer files are never treated as IFC geometry. Git blob SHA values are not content checksums and are not used as such. Plain Git files therefore receive the existing missing-provider-checksum warning.

`original` is the single variant label. Search cards expose actual package bytes (model plus source notices), format IFC and file counts. Polygon counts, preview images and texture sizes are not invented. Ancestor README/LICENSE files are retained as package resources under `provenance/`. Licenses, source URLs, revisions and these notice paths remain in immutable plans. Execution refreshes metadata and rejects changed specifications.

Requests use the shared identifiable User-Agent, conditional metadata cache and one-second per-provider pacing. GitHub's [REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) apply (normally 60 unauthenticated API requests per hour per IP, plus secondary limits); a 403 with rate-limit headers returns `RATE_LIMITED`. Trees and text metadata are cached for 24 hours. Only the two configured repositories on API/raw/media GitHub hosts are allowed, with the existing public-DNS and redirect checks. No GitHub login or arbitrary repository crawling is required. See the [Git Trees API](https://docs.github.com/en/rest/git/trees) for the documented recursive tree response.

These are sample/test collections, not a promise that all IFC entities will validate or tessellate. Existing 256 MiB per-file acquisition limits still apply.
