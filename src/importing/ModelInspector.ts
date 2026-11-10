import fs from 'node:fs';
import path from 'node:path';
import { fail } from '../domain/ModelsError.js';
import type { ModelFormat } from '../domain/types.js';
import { noLinks, relativeFile } from '../storage/paths.js';
export interface InspectedModel {
  entrypoint: string;
  format: ModelFormat;
  files: string[];
  warnings: string[];
}
function read(file: string, max = 32 * 1024 ** 2) {
  if (fs.statSync(file).size > max)
    fail('INVALID_MODEL', 'Inspect model: metadata exceeds size limit');
  return fs.readFileSync(file);
}
function json(bytes: Buffer) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('INVALID_MODEL', 'Inspect model: invalid JSON');
  }
}

/**
 * Checks file envelopes and follows local dependencies. This is not a geometry
 * repair tool or an IFC conformance checker; original coordinates remain intact.
 */
export class ModelInspector {
  inspect(file: string, packageRoot = path.dirname(path.resolve(file))): InspectedModel {
    file = path.resolve(file);
    noLinks(file);
    const entry = path.relative(packageRoot, file).split(path.sep).join('/');
    relativeFile(packageRoot, entry);
    const seen = new Set<string>(),
      warnings: string[] = [];
    let format = path.extname(file).slice(1).toLowerCase() as ModelFormat;
    if (format === ('stp' as string)) format = 'step';
    const add = (name: string) => {
      relativeFile(packageRoot, name);
      const absolute = relativeFile(packageRoot, name);
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile())
        fail('INVALID_MODEL', 'Import model: missing dependency ' + name);
      seen.add(name);
      if (seen.size > 4096) fail('INVALID_MODEL', 'Import model: too many dependencies');
      return absolute;
    };
    const reference = (owner: string, uri: string) => {
      if (uri.startsWith('data:')) return;
      if (/^[a-z][a-z0-9+.-]*:|[?#\\]/i.test(uri))
        fail('PATH_OUTSIDE_ROOT', 'Import model: external or unsafe resource URI');
      let decoded;
      try {
        decoded = decodeURIComponent(uri);
      } catch {
        fail('INVALID_MODEL', 'Import model: invalid resource URI');
      }
      relativeFile(packageRoot, decoded);
      const name = path.posix.join(path.posix.dirname(owner), decoded);
      add(name);
      return name;
    };
    add(entry);
    const stat = fs.statSync(file),
      fd = fs.openSync(file, 'r'),
      head = Buffer.alloc(Math.min(stat.size, 1024 ** 2));
    try {
      fs.readSync(fd, head, 0, head.length, 0);
    } finally {
      fs.closeSync(fd);
    }
    const text = head.toString('utf8');
    let document: any;
    if (format === 'glb') {
      if (
        head.length < 20 ||
        head.toString('ascii', 0, 4) !== 'glTF' ||
        head.readUInt32LE(4) !== 2 ||
        head.readUInt32LE(8) !== stat.size ||
        head.readUInt32LE(16) !== 0x4e4f534a
      )
        fail('INVALID_MODEL', 'Import GLB: invalid version or header');
      const length = head.readUInt32LE(12);
      if (length > 32 * 1024 ** 2 || length + 20 > stat.size)
        fail('INVALID_MODEL', 'Import GLB: invalid JSON chunk');
      const h = fs.openSync(file, 'r'),
        bytes = Buffer.alloc(length);
      try {
        fs.readSync(h, bytes, 0, length, 20);
      } finally {
        fs.closeSync(h);
      }
      document = json(bytes);
    } else if (['gltf', 'json', 'cityjson'].includes(format)) {
      document = json(read(file));
      if (format === ('json' as string)) {
        if (document.asset?.version === '2.0') format = 'gltf';
        else if (document.type === 'CityJSON') format = 'cityjson';
        else if (document.root && document.asset) format = '3dtiles';
        else
          fail('UNSUPPORTED_FORMAT', 'Import JSON: expected glTF, CityJSON or a 3D Tiles tileset');
      }
    }
    if (format === 'gltf' || format === 'glb') {
      if (document?.asset?.version !== '2.0')
        fail('INVALID_MODEL', 'Import glTF: expected asset.version 2.0');
      for (const resource of [...(document.buffers ?? []), ...(document.images ?? [])])
        if (resource.uri) reference(entry, resource.uri);
      if (document.extensionsRequired?.length)
        warnings.push('Required glTF extensions: ' + document.extensionsRequired.join(', '));
    } else if (format === '3dtiles') {
      const walk = (value: any) => {
        if (!value || typeof value !== 'object') return;
        for (const [key, v] of Object.entries(value)) {
          if ((key === 'uri' || key === 'url') && typeof v === 'string') {
            if (v.includes('{'))
              fail(
                'UNSUPPORTED_FORMAT',
                'Import tileset: implicit templates require an explicit bundle',
              );
            const name = reference(entry, v);
            if (name?.endsWith('.json') && !name.endsWith(entry)) {
              warnings.push('Nested tilesets require their dependencies in an explicit manifest.');
            }
          } else walk(v);
        }
      };
      walk(document);
    } else if (format === 'cityjson') {
      if (
        document?.type !== 'CityJSON' ||
        !document.CityObjects ||
        !Array.isArray(document.vertices)
      )
        fail('INVALID_MODEL', 'Import CityJSON: invalid document');
    } else if (format === 'ifc' || format === 'step') {
      if (
        !text.includes('ISO-10303-21;') ||
        !text.includes('FILE_SCHEMA') ||
        (format === 'ifc' && !/FILE_SCHEMA\s*\(\s*\(\s*'IFC/i.test(text))
      )
        fail('INVALID_MODEL', 'Import STEP/IFC: invalid file header');
      const h = fs.openSync(file, 'r'),
        tail = Buffer.alloc(Math.min(4096, stat.size));
      try {
        fs.readSync(h, tail, 0, tail.length, stat.size - tail.length);
      } finally {
        fs.closeSync(h);
      }
      if (!tail.toString().includes('END-ISO-10303-21;'))
        fail('INVALID_MODEL', 'Import STEP/IFC: missing end marker');
    } else if (format === 'obj') {
      const content = read(file, 256 * 1024 ** 2).toString();
      if (!/^v\s+[-+.0-9]/m.test(content)) fail('INVALID_MODEL', 'Import OBJ: no vertex records');
      for (const line of content.split(/\r?\n/)) {
        const m = /^mtllib\s+(.+)$/.exec(line.trim());
        if (!m) continue;
        const name = reference(entry, m[1])!;
        const mtl = read(relativeFile(packageRoot, name)).toString();
        for (const line of mtl.split(/\r?\n/)) {
          const map = /^(?:map_\w+|bump|disp|decal|norm)\s+(.+)$/i.exec(line.trim());
          if (map) {
            if (map[1].startsWith('-'))
              fail(
                'UNSUPPORTED_FORMAT',
                'Import OBJ: MTL map options need an explicit package manifest',
              );
            reference(name, map[1]);
          }
        }
      }
    } else if (format === 'stl') {
      const binary = head.length >= 84 && 84 + head.readUInt32LE(80) * 50 === stat.size;
      if (!binary && !/^\s*solid[\s\S]*facet\s+normal/.test(text))
        fail('INVALID_MODEL', 'Import STL: invalid envelope');
    } else if (format === 'ply') {
      if (
        !/^ply\r?\nformat (ascii|binary_little_endian|binary_big_endian) 1.0/.test(text) ||
        !text.includes('end_header')
      )
        fail('INVALID_MODEL', 'Import PLY: invalid header');
    } else if (format === 'las' || format === 'laz') {
      if (text.slice(0, 4) !== 'LASF' || stat.size < 227)
        fail('INVALID_MODEL', 'Import LAS: invalid header');
    } else if (format === 'e57') {
      if (text.slice(0, 8) !== 'ASTM-E57') fail('INVALID_MODEL', 'Import E57: invalid header');
    } else if (format === 'fbx') {
      if (!text.startsWith('Kaydara FBX Binary') && !text.includes('FBXHeaderExtension'))
        fail('INVALID_MODEL', 'Import FBX: invalid header');
      warnings.push('FBX external resources are not inferred; include them in a manifest.');
    } else if (format === 'blend') {
      if (!text.startsWith('BLENDER') && !(head[0] === 31 && head[1] === 139))
        fail('INVALID_MODEL', 'Import Blender: invalid header');
      warnings.push('Blender resources are preserved only when included in a manifest.');
    } else if (format === 'dxf') {
      if (!text.includes('SECTION') && !text.startsWith('AutoCAD Binary DXF'))
        fail('INVALID_MODEL', 'Import DXF: invalid envelope');
    } else if (format === 'dae') {
      if (!/<(?:\w+:)?COLLADA[\s>]/.test(text))
        fail('INVALID_MODEL', 'Import Collada: invalid envelope');
      warnings.push('Collada resources require an explicit manifest.');
    } else if (['xkt', 'xgf', 'rvt', 'nwd'].includes(format)) {
      if (!stat.size) fail('INVALID_MODEL', 'Import model: empty file');
      warnings.push(
        format.toUpperCase() +
          ' is preserved as an opaque file; format and geometry validity are not checked.',
      );
    } else fail('UNSUPPORTED_FORMAT', 'Import model: unsupported entry file extension');
    return { entrypoint: entry, format, files: [...seen].sort(), warnings };
  }
}
