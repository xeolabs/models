import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { ModelsLibrary } from '@xeokit/models';
import {
  ServerModelsClient,
  ServerPropertiesClient,
  ExternalPropertyLoader,
} from '@xeokit/models/browser';

if (!ModelsLibrary || !ServerModelsClient || !ServerPropertiesClient || !ExternalPropertyLoader)
  throw new Error('Missing public exports');
const connectionString = process.env.MODELS_TEST_DATABASE_URL;
if (!connectionString)
  throw new Error('Set MODELS_TEST_DATABASE_URL to a disposable PostgreSQL database');
const schema = 'test_' + randomUUID().replaceAll('-', '');
const library = await ModelsLibrary.open({
  root: './catalog',
  create: true,
  database: { connectionString, schema },
});
try {
  fs.writeFileSync('triangle.obj', 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
  const model = (await library.importFile({ path: 'triangle.obj' })).model;
  const formats = await library.availableFormats(model.id);
  if (!formats.formats.some((option) => option.format === 'xgf'))
    throw new Error('XGF is not discoverable');
  const xgf = await library.getFormat(model.id, 'xgf');
  const resource = await library.resolveFormatFile(model.id, 'xgf', xgf.entrypoint);
  if (fs.readFileSync(resource.path).readUInt32LE(0) !== 3)
    throw new Error('Installed XGF conversion failed');
  if (!formats.formats.some((option) => option.format === 'xgfstream'))
    throw new Error('XGF Stream is not discoverable');
  const stream = await library.getFormat(model.id, 'xgfstream');
  const index = await library.resolveFormatFile(model.id, 'xgfstream', stream.entrypoint);
  if (JSON.parse(fs.readFileSync(index.path, 'utf8')).format !== 'XGFStreamingRuntimeIndex')
    throw new Error('Installed XGF Stream conversion failed');
  const result = await library.exportConvertedModel({
    modelId: model.id,
    format: 'glb',
    outputPath: 'model.glb',
  });
  if (
    result.entrypoint !== 'model.glb' ||
    fs.readFileSync('model.glb').subarray(0, 4).toString() !== 'glTF'
  )
    throw new Error('Installed GLB conversion failed');
} finally {
  await library.close();
  const admin = new Client({ connectionString });
  await admin.connect();
  try {
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  } finally {
    await admin.end();
  }
}
console.log('Installed Node and browser APIs, format discovery and SDK conversions passed');
