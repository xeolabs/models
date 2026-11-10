
/**
 * Public model files have their own route. Catalog queries and server actions
 * retain their existing origin restrictions.
 */
export function modelFileRoute(pathname: string): RegExpExecArray | null {
  return /^\/models\/([a-f0-9-]{36})\/formats\/([a-z0-9]+)\/files\/(.+)$/.exec(pathname);
}
