import { ConversionPropertyStorage } from './ConversionPropertyStorage.js';
import { JSONDocumentFile } from './JSONDocumentFile.js';
import { readBinaryInput } from './readBinaryInput.js';
import fs from 'node:fs';
import { ModelThumbnail } from './thumbnail/ModelThumbnail';
import { conversionEntrypoint } from '../src/conversion/entrypoint.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ModelConverter } from '@xeokit/sdk/conversion/pipeline';
import { GLTFLoader, GLTFExporter } from '@xeokit/sdk/formats/gltf';
import { XGFLoader, XGFExporter } from '@xeokit/sdk/formats/xgf';
import { XGFStreamExporter } from '@xeokit/sdk/formats/xgfstream/XGFStreamExporter';
import { CONVERSION_LIMITS } from '../src/conversion/limits.js';
import { XeoIFCLoader } from '@xeokit/sdk/formats/ifc/XeoIFCLoader';
import { IFCExporter } from '@xeokit/sdk/formats/ifc/IFCExporter';
import { OBJLoader, OBJExporter } from '@xeokit/sdk/formats/obj';
import { MTLLoader, MTLExporter } from '@xeokit/sdk/formats/mtl';
import { PLYLoader, PLYExporter } from '@xeokit/sdk/formats/ply';
import { STLLoader, STLExporter } from '@xeokit/sdk/formats/stl';
import { FBXLoader, FBXExporter } from '@xeokit/sdk/formats/fbx';
import { CityJSONLoader, CityJSONExporter } from '@xeokit/sdk/formats/cityjson';
import { E57Loader, E57Exporter } from '@xeokit/sdk/formats/e57';
import { LASLoader } from '@xeokit/sdk/formats/las';
import { XKTLoader, XKTExporter } from '@xeokit/sdk/formats/legacy/xkt';
import { DXFExporter } from '@xeokit/sdk/formats/dxf';
import { DataModelExporter, DataModelImporter } from '@xeokit/sdk/formats/datamodel';
import {
  TrianglesPrimitive,
  SolidPrimitive,
  SurfacePrimitive,
  LinesPrimitive,
  PointsPrimitive,
} from '@xeokit/sdk/base/constants';

const loaders = {
  datamodel: new DataModelImporter(),
  gltf: new GLTFLoader(),
  glb: new GLTFLoader(),
  xgf: new XGFLoader(),
  xeoifc: new XeoIFCLoader({
    licenceKey: process.env.MODELS_XEOIFC_LICENSE_KEY,
    engineFactory: async () => {
      const directory = process.env.MODELS_XEOIFC_DIR;
      if (!directory) throw new Error('XeoIFC runtime is not configured.');
      const engine = await import(pathToFileURL(path.join(directory, 'viewer_wasm.js')).href);
      await engine.default({
        module_or_path: fs.readFileSync(path.join(directory, 'viewer_wasm_bg.wasm')),
      });
      return engine;
    },
  }),
  obj: new OBJLoader(),
  mtl: new MTLLoader(),
  ply: new PLYLoader(),
  stl: new STLLoader(),
  fbx: new FBXLoader(),
  cityjson: new CityJSONLoader(),
  e57: new E57Loader(),
  las: new LASLoader(),
  laz: new LASLoader(),
  xkt: new XKTLoader(),
};
const exporters = {
  glb: new GLTFExporter(),
  xgf: new XGFExporter(),
  xgfstream: new XGFStreamExporter(),
  ifc: new IFCExporter(),
  obj: new OBJExporter(),
  ply: new PLYExporter(),
  stl: new STLExporter(),
  fbx: new FBXExporter(),
  cityjson: new CityJSONExporter(),
  dxf: new DXFExporter(),
  e57: new E57Exporter(),
  xkt: new XKTExporter(),
  datamodel: new DataModelExporter(),
};
const triangles = [TrianglesPrimitive, SolidPrimitive, SurfacePrimitive];
const conventional = [...triangles, LinesPrimitive, PointsPrimitive];
const primitives = {
  glb: conventional,
  xgf: null,
  xgfstream: null,
  ifc: triangles,
  obj: triangles,
  ply: [TrianglesPrimitive, PointsPrimitive],
  stl: triangles,
  fbx: triangles,
  cityjson: triangles,
  dxf: conventional,
  e57: [PointsPrimitive],
  xkt: conventional,
  datamodel: null,
};
const notices = {
  glb: ['Binary glTF. Some SDK metadata and object identifiers are not preserved.'],
  xgf: ['xeokit SDK v3 geometry and materials.'],
  xgfstream: [
    'XGF Stream with a runtime index, spatial chunks and shared texture/material assets.',
  ],
  ifc: ['Reconstructed IFC4; this is not a lossless copy of an authored IFC.'],
  obj: ['OBJ with MTL. The SDK encoder omits normals, UV coordinates and texture images.'],
  ply: ['Vertex geometry and colors. Object identities and material assignments are flattened.'],
  stl: ['Triangle geometry only. Units, colors and materials are not preserved.'],
  fbx: [
    'Binary FBX. Shear, negative scales and coordinate metadata are not preserved. Texture images are omitted.',
  ],
  cityjson: ['CityJSON surfaces and supported properties.'],
  dxf: ['3D faces, lines and points. Materials, UV coordinates and line styles are omitted.'],
  e57: ['One point scan with RGB. Intensity and scan poses are not preserved.'],
  xkt: ['Legacy xeokit XKT v12. Only supported metadata is embedded.'],
  datamodel: [
    'xeokit DataModel JSON: object types, properties and relationships. Contains no geometry.',
  ],
};

// Files are supplied by the parent process. Conversion never downloads resources.
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith('data:')) throw new Error('Conversion cannot fetch external resources.');
  return originalFetch(input, init);
};
async function read(loader, file) {
  if (loader.fileDataType !== 'json' && loader.fileDataType !== 'text')
    return readBinaryInput(file);
  if (loader === loaders.datamodel) return JSONDocumentFile.read(file);
  const text = fs.readFileSync(file, 'utf8');
  return loader.fileDataType === 'json' ? JSON.parse(text) : text;
}
function unwrap(result) {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
async function run(request) {
  const properties = new ConversionPropertyStorage(request);
  try {
    if (request.propertyTask) return await properties.transformDocument();
    return await convert(request, properties);
  } finally {
    properties.close();
  }
}
async function convert(request, properties: ConversionPropertyStorage) {
  const inputName = request.sourceFormat === 'ifc' ? 'xeoifc' : request.sourceFormat;
  const loader = loaders[inputName];
  const inputWarnings = [];
  if (!loader) throw new Error('The SDK has no configured loader for this format.');
  const options = {
    ...properties.loaderOptions(),
    baseUri: pathToFileURL(path.dirname(request.entrypoint) + path.sep).href,
    ...(new Set(['gltf', 'glb', 'obj', 'ply', 'fbx']).has(request.sourceFormat)
      ? {
          coordinateSystem: {
            basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
            origin: [0, 0, 0],
            units: 'meters',
          },
        }
      : {}),
    onWarning: (message) => inputWarnings.push(message),
    retainTextureBytes: true,
    preserveTransforms: true,
    yieldIntervalMs: 50,
  };
  const inputs = {},
    config = {};
  if (request.sourceFormat === 'obj') {
    for (const [index, file] of request.materialFiles.entries()) {
      const id = 'mtl' + index;
      config[id] = { loader: 'mtl', sceneModel: 'model', dataModel: 'model' };
      inputs[id] = { fileData: await read(loaders.mtl, file) };
    }
  }
  config.model = { loader: inputName, options, sceneModel: 'model', dataModel: 'model' };
  inputs.model = { fileData: await read(loader, request.entrypoint) };
  const converter = new ModelConverter({
    loaders,
    exporters: {},
    pipelines: { load: { inputs: config, outputs: {} } },
  });
  process.send?.({
    progress: {
      phase:
        request.sourceFormat === 'ifc'
          ? 'Reading IFC'
          : 'Reading ' + request.sourceFormat.toUpperCase(),
    },
  });
  const loaded = await converter.convert({ pipeline: 'load', inputs });
  try {
    const errors = [
      ...loaded.errors,
      ...Object.values(loaded.inputs).flatMap((input) => input.errors),
    ];
    if (errors.length) throw new Error(errors.join('\n'));
    const sceneModel = loaded.scene.models.model;
    let dataModel = loaded.data.models.model;
    if (request.dataModelFile) {
      // XGF v3 may already contain semantics. Replace that model with the exact
      // cached JSON instead of importing the same objects twice.
      unwrap(dataModel.destroy());
      dataModel = unwrap(
        loaded.data.createModel(await read(loaders.datamodel, request.dataModelFile)),
      );
    }
    const propertyDatabase = properties.finish(dataModel);
    properties.loadForExport(dataModel);
    const meshes = Object.values(sceneModel.meshes);
    const semantic = Object.keys(dataModel.objects).length > 0;
    if (!meshes.length && !semantic)
      throw new Error('The SDK found no supported geometry or semantic data to convert.');
    const kinds = new Set(meshes.map((mesh) => mesh.geometry.primitive));
    const animations = Object.keys(sceneModel.animations).length > 0;
    const vertexStates = meshes.some((mesh) => mesh.geometry.vertexStatesCompressed?.length);
    const morphs = meshes.some((mesh) => mesh.geometry.morphTargets?.length);
    const textures = Object.keys(sceneModel.textures).length > 0;
    const formats = Object.keys(exporters)
      .filter(
        (format) =>
          format !== request.sourceFormat &&
          (format === 'datamodel' ? semantic : meshes.length > 0) &&
          (!primitives[format] || [...kinds].every((kind) => primitives[format].includes(kind))) &&
          !(format === 'glb' && vertexStates) &&
          !(format === 'xgfstream' && Object.keys(sceneModel.representations).length),
      )
      .map((format) => ({
        format,
        warnings:
          format === 'datamodel'
            ? [...notices.datamodel, ...inputWarnings]
            : [
                ...notices[format],
                ...inputWarnings,
                ...(animations && !['glb', 'xgf'].includes(format)
                  ? ['Animation is not preserved; static geometry is written.']
                  : []),
                ...(morphs && !['glb', 'xgf', 'xgfstream'].includes(format)
                  ? ['Morph targets are not preserved.']
                  : []),
                ...(vertexStates && !['xgf', 'xgfstream'].includes(format)
                  ? ['Alternate vertex states are not preserved.']
                  : []),
                ...(textures && !['glb', 'xgf', 'xgfstream'].includes(format)
                  ? ['Texture images are not included in this format.']
                  : []),
                ...(format === 'xgfstream' && Object.keys(sceneModel.variantSets).length
                  ? ['Authored variant selections are not preserved in the stream.']
                  : []),
                ...(semantic
                  ? [
                      'A DataModel JSON companion preserves the source semantic graph; geometry identifiers may change.',
                    ]
                  : []),
                ...(request.sourceFormat === 'obj'
                  ? [
                      'The SDK OBJ/MTL importer reads material colors, but does not import texture maps.',
                    ]
                  : []),
              ],
      }));
    const thumbnail = () => {
      process.send?.({ progress: { phase: 'Rendering thumbnail' } });
      const preview = new ModelThumbnail().render(sceneModel);
      fs.writeFileSync(path.join(request.output, 'thumbnail.png'), preview.png, { flag: 'wx' });
      if (preview.simplified)
        inputWarnings.push('Thumbnail simplified to stay within its rendering budget.');
      return 'thumbnail.png';
    };
    if (request.thumbnailOnly) return { thumbnail: thumbnail() };
    if (!request.format) return { formats };
    const selected = formats.find((item) => item.format === request.format);
    if (!selected) throw new Error('This output cannot safely represent the model geometry.');
    const warnings = [...selected.warnings];
    const exporter = exporters[request.format];
    process.send?.({ progress: { phase: 'Writing ' + request.format.toUpperCase() } });
    const result = unwrap(
      await exporter.write(
        { sceneModel, dataModel, ...(request.format === 'xgf' ? { version: '3.0.0' } : {}) },
        {
          ...(new Set(['glb', 'obj', 'ply', 'fbx']).has(request.format)
            ? {
                coordinateSystem: {
                  basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
                  origin: [0, 0, 0],
                  units: 'meters',
                },
              }
            : {}),
          ...(request.format === 'xgfstream'
            ? {
                partition: 'grid',
                chunkSize: 500,
                assetLibraryChunkSize: 16,
                sharedAssetMode: 'sharded',
                sharedAssetShardSize: 512,
                index: 'index.json',
                runtimeIndex: 'index.runtime.json',
                baseUri: '',
              }
            : {}),
          mtlFileName: 'model.mtl',
          onWarning: (message) => warnings.push(message),
        },
      ),
    );
    process.send?.({ progress: { phase: 'Saving ' + request.format.toUpperCase() } });
    const entrypoint = conversionEntrypoint(request.format);
    const files = [];
    const names = new Set();
    let writtenBytes = 0;
    const save = async (name, value, type) => {
      // Even SDK-generated paths must remain inside this conversion's private output directory.
      if (
        !name ||
        path.isAbsolute(name) ||
        /[\\:\x00]/.test(name) ||
        name.split('/').some((part) => !part || part === '.' || part === '..') ||
        name.toLowerCase() === 'manifest.json' ||
        names.has(name.toLowerCase())
      )
        throw new Error('The SDK returned an unsafe or duplicate output path.');
      if (files.length >= CONVERSION_LIMITS.files)
        throw new Error('Converted output exceeds 4096 files.');
      const target = path.join(request.output, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (type === 'json') {
        writtenBytes += await JSONDocumentFile.write(
          target,
          value,
          CONVERSION_LIMITS.bytes - writtenBytes,
        );
      } else {
        const data = typeof value === 'string' ? value : Buffer.from(value);
        writtenBytes += Buffer.byteLength(data);
        if (writtenBytes > CONVERSION_LIMITS.bytes)
          throw new Error('Converted output exceeds 3 GiB.');
        fs.writeFileSync(target, data, { flag: 'wx' });
      }
      names.add(name.toLowerCase());
      files.push(name);
    };
    if (request.format === 'xgfstream') {
      // The SDK supplies complete, relative chunk references. Keep the file map intact.
      for (const [name, value] of Object.entries(result.files))
        await save(name, value, value instanceof ArrayBuffer ? 'arraybuffer' : 'json');
    } else {
      await save(entrypoint, result, exporter.fileDataType);
    }
    if (request.format === 'obj') {
      const mtl = unwrap(await new MTLExporter().write({ sceneModel }));
      // The OBJ encoder omits UVs. Remove texture references rather than emitting broken local paths.
      await save(
        'model.mtl',
        mtl
          .split('\n')
          .filter((line) => !/^(?:map_|bump |disp |decal )/.test(line))
          .join('\n'),
        'text',
      );
    }
    if (semantic && request.format !== 'datamodel') {
      process.send?.({ progress: { phase: 'Writing DataModel JSON' } });
      const data = unwrap(await new DataModelExporter().write({ dataModel }));
      await save('model.datamodel.json', data, 'json');
    }
    let preview;
    if (request.makeThumbnail) {
      try {
        preview = thumbnail();
      } catch (error) {
        warnings.push(
          'Thumbnail unavailable: ' + (error instanceof Error ? error.message : String(error)),
        );
      }
    }
    return {
      propertyDatabase,
      thumbnail: preview,
      entrypoint,
      files,
      warnings: [...new Set(warnings)],
      ...(request.includeOptions ? { options: { formats } } : {}),
    };
  } finally {
    loaded.scene.destroy();
    loaded.data.destroy();
  }
}
// If the server exits, no orphaned worker should keep using CPU.
process.once('disconnect', () => process.exit(0));
process.once('message', (request) => {
  void run(request)
    .then(
      (result) => process.send?.({ ok: true, result }),
      (error) =>
        process.send?.({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
    )
    .finally(() => process.disconnect());
});
