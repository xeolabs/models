import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { fail } from '../domain/ModelsError.js';
import type { ProviderId } from './types.js';
const allowed = {
  buildingsmart: {
    'api.github.com': ['/repos/buildingSMART/Certification-datasets/'],
    'raw.githubusercontent.com': ['/buildingSMART/Certification-datasets/'],
    'media.githubusercontent.com': ['/media/buildingSMART/Certification-datasets/'],
  },
  'buildingsmart-community': {
    'api.github.com': ['/repos/buildingsmart-community/Community-Sample-Test-Files/'],
    'raw.githubusercontent.com': ['/buildingsmart-community/Community-Sample-Test-Files/'],
    'media.githubusercontent.com': ['/media/buildingsmart-community/Community-Sample-Test-Files/'],
  },

  sketchfab: { 'api.sketchfab.com': ['/v3/'] },
  smithsonian: { '3d-api.si.edu': ['/api/v1.0/content/file/search', '/content/document/'] },
  polyhaven: {
    'api.polyhaven.com': ['/'],
    'dl.polyhaven.org': ['/file/ph-assets/Models/', '/file/ph-assets/Textures/'],
  },
} as const;
const previewHosts = {
  buildingsmart: {},
  'buildingsmart-community': {},
  sketchfab: { 'media.sketchfab.com': ['/models/'] },
  smithsonian: { '3d-api.si.edu': ['/content/document/'] },
  polyhaven: { 'cdn.polyhaven.com': ['/asset_img/thumbs/'] },
} as const;
export type ProviderRequestPurpose = 'asset' | 'preview';
export function providerUrl(
  provider: ProviderId,
  value: string,
  purpose: ProviderRequestPurpose = 'asset',
): URL {
  // URL parsing normalizes dot segments, so reject them before that normalization.
  const rawPath = value.split(/[?#]/, 1)[0];
  if (/%2f|%5c|%2e|\\/i.test(rawPath) || /\/\.\.?(?:\/|$)/.test(rawPath))
    fail('INVALID_PROVIDER_RESPONSE', 'Provider request: unsafe path');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail('INVALID_PROVIDER_RESPONSE', 'Provider request: invalid URL');
  }
  const hosts = purpose === 'preview' ? previewHosts : allowed;
  const paths = (hosts[provider] as Record<string, readonly string[]> | undefined)?.[url.host];
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    !paths?.some((p) => (p.endsWith('/') ? url.pathname.startsWith(p) : url.pathname === p))
  )
    fail(
      'INVALID_PROVIDER_RESPONSE',
      'Provider request: URL is outside the approved HTTPS hosts and paths',
    );
  if (/%2f|%5c|%2e|\\/i.test(url.pathname))
    fail('INVALID_PROVIDER_RESPONSE', 'Provider request: encoded path is not allowed');
  return url;
}

/**
 * Fail closed for non-global addresses, including IPv4-mapped IPv6 and documentation ranges.
 */
export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(address) !== 6) return false;
  const first = parseInt(address.split(':')[0], 16);
  return (
    first >= 0x2000 &&
    first <= 0x3fff &&
    first !== 0x2002 &&
    !(first === 0x2001 && parseInt(address.split(':')[1] || '0', 16) < 0x200) &&
    !/^2001:db8:/i.test(address)
  );
}
export async function resolvePublic(host: string, resolver = lookup) {
  const addresses = await resolver(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    fail('INVALID_PROVIDER_RESPONSE', 'Provider request: DNS resolved to a non-public address');
  return addresses[0];
}
