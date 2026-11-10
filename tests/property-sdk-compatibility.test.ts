import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { expect, test } from 'vitest';
import { ExternalPropertyLoader } from '../src/browser/ExternalPropertyLoader.js';

const sdk = process.env.XEOKIT_SDK_PATH ?? path.resolve('../sdk-oct2');
test.skipIf(!fs.existsSync(path.join(sdk, 'src/model/data/Data.ts')))(
  'the client attaches and evicts real SDK property sets without a renderer',
  async () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'models-property-sdk-'));
    try {
      const file = path.join(output, 'data.mjs');
      await build({
        stdin: {
          resolveDir: sdk,
          contents: `export {Data} from "./src/model/data/index.ts";
            export {DataModelImporter} from "./src/formats/datamodel/DataModelImporter.ts";`,
        },
        outfile: file,
        bundle: true,
        platform: 'node',
        format: 'esm',
        logLevel: 'silent',
      });
      const { Data, DataModelImporter } = await import(file);
      const data = new Data();
      const model = data.createModel({ id: 'model' }).value;
      const imported = await new DataModelImporter().load({
        dataModel: model,
        fileData: {
          version: '1.0',
          id: 'source',
          propertySetMode: 'external',
          revisionId: 'a'.repeat(64),
          objects: [
            { id: 'one', name: 'One', type: 'IfcWall', propertySetIds: ['a'] },
            { id: 'two', name: 'Two', type: 'IfcWall', propertySetIds: ['b'] },
          ],
        },
      });
      expect(imported.ok).toBe(true);
      expect(model.revisionId).toBe('a'.repeat(64));
      const set = (id: string) => ({
        id,
        name: 'Test',
        type: 'IfcPropertySet',
        properties: [{ name: 'FireRating', value: '2h' }],
      });
      const client = {
        async *iteratePropertySets(_id: string, options: { ids: readonly string[] }) {
          yield options.ids.map(set);
        },
      };
      const loader = new ExternalPropertyLoader(
        client,
        'source',
        model,
        JSON.stringify(set('a')).length,
      );
      await loader.loadObject('one');
      expect(model.objects.one.propertySets[0].properties[0].value).toBe('2h');
      await loader.loadObject('two');
      expect(model.objects.one.unresolvedPropertySetIds).toEqual(['a']);
      expect(model.objects.two.unresolvedPropertySetIds).toEqual([]);
      loader.dispose();
      expect(model.objects.two.unresolvedPropertySetIds).toEqual(['b']);
      await expect(loader.loadObject('one')).rejects.toMatchObject({ name: 'AbortError' });
      data.destroy();
    } finally {
      fs.rmSync(output, { recursive: true, force: true });
    }
  },
);
