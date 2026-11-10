
/**
 * The picker returns a catalog identity. Model files always come from the configured server.
 * Every message belongs to one request and must also pass the caller's origin and window checks.
 */
export const modelPickerProtocol = 'xeokit.models.picker';
export const modelPickerVersion = 1;
export interface ModelPickerCapabilities {
  protocol: typeof modelPickerProtocol;
  version: 1;
  allowedOrigins: string[];
  library: { name: string; modelCount: number };
}
export interface ModelPickerBrowseState {
  workspace: 'library' | 'acquisition';
  libraryText: string;
  remoteText: string;
  remoteProvider: string;
  selectedId?: string;
  jobId?: string;
  planId?: string;
}
export interface ModelPickerRequest {
  requestId: string;
  origin: string;
  formats: string[];
  theme: 'light' | 'dark';
  selectedId?: string;
  browseState?: ModelPickerBrowseState;
}
export interface ModelPickerMessage {
  protocol: typeof modelPickerProtocol;
  version: 1;
  requestId: string;
  type:
    | 'ready'
    | 'connected'
    | 'highlight'
    | 'select'
    | 'accepted'
    | 'error'
    | 'cancel'
    | 'theme'
    | 'ended'
    | 'browse';
  modelId?: string;
  updatedAt?: string;
  message?: string;
  browseState?: ModelPickerBrowseState;
  theme?: 'light' | 'dark';
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function validBrowseState(value: unknown): value is ModelPickerBrowseState {
  if (!value || typeof value !== 'object') return false;
  const state = value as ModelPickerBrowseState;
  return (
    ['library', 'acquisition'].includes(state.workspace) &&
    [state.libraryText, state.remoteText, state.remoteProvider].every(
      (value) => typeof value === 'string' && value.length <= 1000,
    ) &&
    [state.selectedId, state.jobId, state.planId].every(
      (value) => value === undefined || (typeof value === 'string' && uuid.test(value)),
    )
  );
}

export function httpOrigin(value: string): string {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.origin !== value ||
    url.username ||
    url.password
  )
    throw new Error('Expected an exact HTTP or HTTPS origin.');
  return url.origin;
}

export function readPickerRequest(search: string): ModelPickerRequest {
  const params = new URLSearchParams(search);
  const requestId = params.get('request') ?? '';
  if (!uuid.test(requestId))
    throw new Error('This picker link has no valid Studio request. Reopen it from Studio.');
  const origin = httpOrigin(params.get('origin') ?? '');
  const formats = [...new Set((params.get('formats') ?? '').split(',').filter(Boolean))];
  if (!formats.length || formats.length > 40 || formats.some((value) => !/^[a-z0-9]+$/.test(value)))
    throw new Error('This picker link has no valid supported formats.');
  const selectedId = params.get('selected') || undefined;
  if (selectedId && !uuid.test(selectedId)) throw new Error('Invalid selected model.');
  const browse = params.get('browse');
  if (browse && browse.length > 8000) throw new Error('Picker browsing state is too large.');
  const browseState = browse ? JSON.parse(browse) : undefined;
  if (browseState && !validBrowseState(browseState))
    throw new Error('Invalid picker browsing state.');
  return {
    requestId,
    origin,
    formats,
    theme: params.get('theme') === 'light' ? 'light' : 'dark',
    selectedId,
    browseState,
  };
}

export function pickerUrl(baseUrl: string, request: ModelPickerRequest): string {
  const url = new URL(baseUrl.replace(/\/$/, '') + '/picker');
  url.search = new URLSearchParams({
    request: request.requestId,
    origin: request.origin,
    formats: request.formats.join(','),
    theme: request.theme,
    ...(request.selectedId ? { selected: request.selectedId } : {}),
    ...(request.browseState ? { browse: JSON.stringify(request.browseState) } : {}),
  }).toString();
  readPickerRequest(url.search);
  return url.href;
}

export function pickerMessage(
  requestId: string,
  type: ModelPickerMessage['type'],
  fields: Partial<
    Pick<ModelPickerMessage, 'modelId' | 'updatedAt' | 'message' | 'theme' | 'browseState'>
  > = {},
): ModelPickerMessage {
  return { protocol: modelPickerProtocol, version: modelPickerVersion, requestId, type, ...fields };
}

export function isPickerMessage(value: unknown, requestId: string): value is ModelPickerMessage {
  if (!value || typeof value !== 'object') return false;
  const item = value as ModelPickerMessage;
  if (item.protocol !== modelPickerProtocol || item.version !== 1 || item.requestId !== requestId)
    return false;
  if (
    ![
      'ready',
      'connected',
      'highlight',
      'select',
      'accepted',
      'error',
      'cancel',
      'theme',
      'ended',
      'browse',
    ].includes(item.type)
  )
    return false;
  if (item.type === 'select' || item.type === 'highlight') {
    if (typeof item.modelId !== 'string' || !uuid.test(item.modelId)) return false;
  }
  if (
    item.type === 'select' &&
    (typeof item.updatedAt !== 'string' ||
      item.updatedAt.length > 64 ||
      !Number.isFinite(Date.parse(item.updatedAt)))
  )
    return false;
  if (item.type === 'error' && (typeof item.message !== 'string' || item.message.length > 2000))
    return false;
  if (item.type === 'browse' && !validBrowseState(item.browseState)) return false;
  if (item.type === 'theme' && item.theme !== 'dark' && item.theme !== 'light') return false;
  return true;
}
