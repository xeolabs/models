import { IfcAPI } from 'web-ifc';
import path from 'node:path';

/**
 * The SDK IFC exporter still uses web-ifc to write STEP records. This adapter is
 * for output only; IFC input is registered separately as XeoIFCLoader.
 */
let initialized: Promise<IfcAPI> | undefined;
export function getInitializedIFCAPI(): Promise<IfcAPI> {
  initialized ??= (async () => {
    const api = new IfcAPI();
    await api.Init((name) => path.join(__dirname, name));
    return api;
  })();
  return initialized;
}
