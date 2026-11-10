
/**
 * A geometry in a pinned XGF library shard. Namespace identifies the library,
 * id identifies model and geometry, and variant is a validated package path.
 */
export interface SceneGeometryReference {

  /**
   * Stable verified Models library identity, independent of its server URL.
   */
  namespace: string;

  /**
   * Discriminator identifying this as a geometry reference.
   */
  kind: 'geometry';

  /**
   * Canonical encoded model/geometry identity. Obtain it from sceneAssets.references() rather than assembling it.
   */
  id: string;

  /**
   * SHA-256 of the XGF library shard containing this geometry.
   */
  revision: string;

  /**
   * Validated relative path of that shard within the converted model package.
   */
  variant: string;

  /**
   * Expected SHA-256 of the complete shard bytes; equal to revision.
   */
  sha256: string;
}

/**
 * One verified XGF shard for a resolver batch. Several requested geometries can share these bytes; decode them together with readXGFGeometryAssets().
 */
export interface SceneGeometryFile {

  /**
   * Exact requested identities contained in this shard.
   */
  references: SceneGeometryReference[];

  /**
   * File-local IDs to pass to readXGFGeometryAssets(), corresponding to references.
   */
  geometryIds: string[];

  /**
   * Complete verified shard bytes, also supplied as sourceBytes when staging hash-pinned definitions.
   */
  bytes: Uint8Array<ArrayBuffer>;
}
