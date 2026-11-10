// Test double derived from the SDK XeoIFCLoader tests. It exercises the real
// adapter and subprocess boundary without redistributing a licensed WASM engine.
let initialized = false;
export default async function initialize({ module_or_path }) {
  if (module_or_path[1] !== 97) throw new Error('WASM bytes were not supplied');
  initialized = true;
}
export function worker_load_begin(segments) {
  if (!initialized || segments !== 24) throw new Error('Engine was not initialized');
}
export function worker_load_chunk(bytes) {
  if (!new TextDecoder().decode(bytes).includes('ISO-10303-21;'))
    throw new Error('IFC bytes missing');
}
export function worker_load_finish() {
  const instancesAt = 37,
    elementsAt = 61,
    verticesAt = 69;
  const bytes = new Uint8Array((verticesAt + 18 + 3) * 4);
  const u = new Uint32Array(bytes.buffer),
    f = new Float32Array(bytes.buffer);
  u.set([0x50434649, 1, 1, 1, 1, 18, 3], 8);
  u.set([0, 0, 3], 28);
  f.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0.2, 0.4, 0.6, 1], instancesAt);
  u.set([0, 0, 1, 0], instancesAt + 20);
  u[elementsAt] = 2;
  f.set([0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1], verticesAt);
  u.set([0, 1, 2], verticesAt + 18);
  return {
    packed: bytes,
    tree: JSON.stringify({
      entity_id: 1,
      global_id: 'project',
      type: 'IfcProject',
      name: 'Project',
      children: [{ entity_id: 2, global_id: 'wall', type: 'IfcWall', name: 'Wall' }],
    }),
    sourceId: 8,
    warnings: ['Test engine diagnostic'],
  };
}
export function worker_metadata_finish() {
  return worker_load_finish();
}
export function worker_properties() {
  return '[{"pset":"Dimensions","props":[{"name":"Height","value":3,"unit":"m"}]}]';
}
export function worker_release_model() {}
export function worker_clear_models() {}
export function worker_set_licence_key() {}
