import { ToolError } from './tool.js';

const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Whether a hostname is on this machine or a reserved test name, which is safe by default. */
export function isLocalHostname(hostname: string): boolean {
  // WHATWG URL parsing already lowercases hostnames.
  return (
    LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.test')
  );
}

/**
 * Parses and checks a `send_test_webhook` target. Signed requests stay on the developer's machine
 * unless BONUM_MCP_ALLOW_REMOTE_WEBHOOK_TARGETS=true opts in to remote hosts.
 */
export function checkTarget(raw: string, allowRemote: boolean): URL {
  const url = URL.canParse(raw) ? new URL(raw) : undefined;
  if (url === undefined || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    throw new ToolError(
      'url must be an absolute http:// or https:// URL, e.g. http://localhost:3000/webhooks/bonum.',
    );
  }
  if (url.username !== '' || url.password !== '') {
    throw new ToolError('url must not contain credentials.');
  }
  if (!allowRemote && !isLocalHostname(url.hostname)) {
    throw new ToolError(
      `Refusing to send test webhooks to ${url.hostname}: by default send_test_webhook only ` +
        'targets localhost, 127.0.0.1, [::1], *.localhost and *.test, so signed requests never ' +
        'leave your machine by accident. To test a deployed or tunneled endpoint, set ' +
        'BONUM_MCP_ALLOW_REMOTE_WEBHOOK_TARGETS=true in the env of the "bonum" MCP server.',
    );
  }
  return url;
}
