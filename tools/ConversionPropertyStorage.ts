import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PropertyDatabaseWriter } from '../src/properties/PropertyDatabaseWriter.js';
import type { ModelPropertySet } from '../src/properties/types.js';
import type { ConversionRequest } from '../src/conversion/types.js';
import { DataModelPropertyFile } from './DataModelPropertyFile.js';

/**
 * Owns property output inside a conversion worker. The parent alone publishes it.
 */
export class ConversionPropertyStorage {
  private writer?: PropertyDatabaseWriter;
  constructor(private readonly request: ConversionRequest) {}
  private openWriter(): PropertyDatabaseWriter {
    const { propertyModelId, propertyRevision, output } = this.request;
    if (!propertyModelId || !propertyRevision)
      throw new Error('Property output requires a model and revision.');
    return (this.writer = new PropertyDatabaseWriter(
      path.join(output, 'properties.db'),
      propertyModelId,
      propertyRevision,
    ));
  }
  loaderOptions() {
    if (this.request.sourceFormat !== 'ifc' || this.request.propertySetMode !== 'external')
      return {};
    const writer = this.openWriter();
    return { propertySetSink: writer.writeObject.bind(writer) };
  }
  finish(dataModel: { revisionId?: string | number }): string | undefined {
    if (!this.writer) return;
    dataModel.revisionId = this.request.propertyRevision;
    this.writer.finish();
    return 'properties.db';
  }
  async transformDocument() {
    const input = this.request.dataModelFile;
    if (!input) throw new Error('Property conversion requires DataModel JSON.');
    const output = path.join(this.request.output, 'model.datamodel.json');
    if (this.request.propertyTask === 'externalize') {
      const writer = this.openWriter();
      await DataModelPropertyFile.externalize(
        input,
        output,
        writer,
        this.request.propertyRevision!,
      );
      writer.finish();
    } else if (this.request.propertyDatabaseFile) {
      await DataModelPropertyFile.embed(input, output, this.request.propertyDatabaseFile);
    } else {
      await fs.promises.copyFile(input, output, fs.constants.COPYFILE_EXCL);
    }
    return {
      entrypoint: 'model.datamodel.json',
      files: ['model.datamodel.json'],
      warnings: [],
      ...(this.writer ? { propertyDatabase: 'properties.db' } : {}),
    };
  }
  loadForExport(dataModel: {
    createPropertySet: (set: ModelPropertySet) => { ok: boolean; error?: string };
  }): void {
    if (
      !this.request.propertyDatabaseFile ||
      !['ifc', 'cityjson', 'xkt'].includes(this.request.format ?? '')
    )
      return;
    const db = new DatabaseSync(this.request.propertyDatabaseFile, { readOnly: true });
    try {
      for (const row of db.prepare('SELECT json FROM property_sets ORDER BY id').iterate()) {
        const result = dataModel.createPropertySet(JSON.parse(row.json as string));
        if (result.ok === false) throw new Error(result.error);
      }
    } finally {
      db.close();
    }
  }
  close(): void {
    this.writer?.close();
  }
}
