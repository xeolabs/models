import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { fixture, gltf } from './helpers.js';
const ifc = "ISO-10303-21;\nHEADER;FILE_SCHEMA(('IFC4'));ENDSEC;DATA;ENDSEC;END-ISO-10303-21;";
test.each([
  ['ifc', ifc],
  ['step', ifc.replace('IFC4', 'AUTOMOTIVE_DESIGN')],
  ['obj', 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3'],
  ['stl', 'solid part\nfacet normal 0 0 1\nendsolid'],
  ['ply', 'ply\nformat ascii 1.0\nelement vertex 0\nend_header'],
  ['e57', 'ASTM-E57'],
  ['fbx', '; FBX 7.4\nFBXHeaderExtension: {}'],
  ['blend', 'BLENDER-v300'],
  ['dxf', '0\nSECTION\n2\nHEADER'],
  ['dae', '<COLLADA xmlns="urn:test"></COLLADA>'],
  ['xgf', 'opaque'],
  ['xkt', 'opaque'],
  ['rvt', 'opaque'],
  ['nwd', 'opaque'],
])('imports %s envelopes without rewriting coordinates or contents', async (ext, content) => {
  const f = await fixture();
  try {
    const file = path.join(f.source, 'model.' + ext);
    fs.writeFileSync(file, content);
    const model = (await f.library.importFile({ path: file })).model!;
    expect(fs.readFileSync(await f.library.resolveAsset(model.files[0].assetId), 'utf8')).toBe(
      content,
    );
    expect(model.format).toBe(ext);
  } finally {
    await f.close();
  }
});
test('GLB JSON envelopes and OBJ material dependencies are preserved', async () => {
  const f = await fixture();
  try {
    const json = Buffer.from(gltf.toString().padEnd(Math.ceil(gltf.length / 4) * 4, ' ')),
      glb = Buffer.alloc(20 + json.length);
    glb.write('glTF');
    glb.writeUInt32LE(2, 4);
    glb.writeUInt32LE(glb.length, 8);
    glb.writeUInt32LE(json.length, 12);
    glb.writeUInt32LE(0x4e4f534a, 16);
    json.copy(glb, 20);
    fs.writeFileSync(path.join(f.source, 'model.glb'), glb);
    expect(
      (await f.library.importFile({ path: path.join(f.source, 'model.glb') })).model?.format,
    ).toBe('glb');
    fs.writeFileSync(path.join(f.source, 'model.obj'), 'mtllib model.mtl\nv 0 0 0');
    fs.writeFileSync(path.join(f.source, 'model.mtl'), 'newmtl surface\nmap_Kd diffuse.png');
    fs.writeFileSync(path.join(f.source, 'diffuse.png'), 'image');
    expect(
      (await f.library.importFile({ path: path.join(f.source, 'model.obj') })).files,
    ).toHaveLength(3);
  } finally {
    await f.close();
  }
});
