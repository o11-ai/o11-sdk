import { expect, test } from 'bun:test';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auth } from '@modelcontextprotocol/client';
import { CliAuth } from '../src/vault';
import { decodeLoginInput, maxLoginInputBytes, readLoginInput, redirectUrl, submitLoginInput } from '../src/login-input';
import { remoteLoginEnvironment } from '../src/login-browser';
import { startLoginListener } from '../src/login-listener';

const envelope = (url: string) => `o11-login:${Buffer.from(url).toString('base64url')}`;
const callback = (state = 'test-state', issuer = 'https://issuer.example') => `${redirectUrl}?${new URLSearchParams({ code: 'test-code', state, iss: issuer })}`;

test('sign-in code preserves the full callback and rejects destinations or ambiguous responses', () => {
  expect(decodeLoginInput(`\n${envelope(callback())}\n`).href).toBe(callback());
  const invalid = [
    'https://evil.example/callback?code=test-code&state=test-state',
    'http://127.0.0.1:49192/callback?code=test-code&state=test-state',
    'http://localhost:49191/callback?code=test-code&state=test-state',
    'http://user:password@127.0.0.1:49191/callback?code=test-code&state=test-state',
    `${callback()}#fragment`, `${callback()}&code=other`, `${callback()}&state=other`, `${callback()}&iss=other`, `${callback()}&error=access_denied`,
    `${redirectUrl}?code=test-code`, `${redirectUrl}?code=&state=test-state`, `${redirectUrl}?code=test-code&state=test-state`, `${redirectUrl}?code=test-code&state=test-state&iss=`,
  ];
  for (const url of invalid) expect(() => decodeLoginInput(envelope(url))).toThrow('Invalid sign-in code');
  for (const input of [callback(), 'test-code', 'o11-login:AA=', 'o11-login:_w', 'o11-login:AB']) expect(() => decodeLoginInput(input)).toThrow('Invalid sign-in code');
  expect(() => decodeLoginInput('x'.repeat(maxLoginInputBytes + 1))).toThrow('32 KiB');
});

test('file input is bounded before submission', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'o11-login-input-'));
  try {
    const path = join(directory, 'response');
    await writeFile(path, envelope(callback()), { mode: 0o600 });
    expect(await readLoginInput(path)).toBe(envelope(callback()));
    await writeFile(path, 'x'.repeat(maxLoginInputBytes + 1));
    await expect(readLoginInput(path)).rejects.toThrow('32 KiB');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('SSH, cloud workspaces and headless Linux do not launch a browser', () => {
  expect(remoteLoginEnvironment({ SSH_CONNECTION: 'test', DISPLAY: ':0' })).toBe(true);
  expect(remoteLoginEnvironment({ CODESPACES: 'true', DISPLAY: ':0' })).toBe(true);
  expect(remoteLoginEnvironment({ DISPLAY: ':0' })).toBe(false);
  if (process.platform === 'linux') expect(remoteLoginEnvironment({})).toBe(true);
});

test('copied response reaches the existing listener and wrong state leaves it waiting', async () => {
  const listener = await startLoginListener(() => 'test-state');
  try {
    await expect(submitLoginInput(envelope(callback('wrong-state')))).rejects.toThrow('rejected');
    expect(await submitLoginInput(envelope(callback()))).toMatchObject({ received: true });
    expect((await listener.callback).get('iss')).toBe('https://issuer.example');
    await expect(submitLoginInput(envelope(callback()))).rejects.toThrow('rejected');
  } finally { await listener.close(); }
});

test('login --input - submits through stdin without loading a profile or printing the response', async () => {
  const listener = await startLoginListener(() => 'test-state');
  const directory = await mkdtemp(join(tmpdir(), 'o11-login-command-'));
  try {
    const command = Bun.spawn(['bun', new URL('../src/index.ts', import.meta.url).pathname, 'login', '--input', '-'], { cwd: directory, env: { ...process.env, O11_CONFIG_DIR: directory, O11_SERVER: '' }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    command.stdin.write(`${envelope(callback())}\n`);
    command.stdin.end();
    const output = await new Response(command.stdout).text();
    expect(await command.exited).toBe(0);
    expect(JSON.parse(output)).toMatchObject({ received: true });
    expect(output).not.toContain('test-code');
    expect(output).not.toContain('o11-login:');
    expect((await listener.callback).get('state')).toBe('test-state');
  } finally { await listener.close(); await rm(directory, { recursive: true, force: true }); }
});

test('declined consent ends the pending login and cannot be submitted as success', async () => {
  const listener = await startLoginListener(() => 'test-state');
  try {
    const response = await fetch(`${redirectUrl}?error=access_denied&state=test-state`);
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(listener.callback).rejects.toThrow('declined');
  } finally { await listener.close(); }
});

test('missing listener requires a new login instead of starting a fresh flow', async () => {
  await expect(submitLoginInput(envelope(callback()))).rejects.toThrow('Start o11 login --no-browser');
});

test('an unrelated local listener cannot redirect the sign-in response', async () => {
  const listener = createServer((_, response) => { response.writeHead(302, { Location: 'https://evil.example/' }); response.end(); });
  await new Promise<void>(resolve => listener.listen(49191, '127.0.0.1', resolve));
  try { await expect(submitLoginInput(envelope(callback()))).rejects.toThrow('No waiting login'); }
  finally { listener.closeAllConnections(); await new Promise<void>(resolve => listener.close(() => resolve())); }
});

test('remote handoff keeps PKCE and issuer verification before token redemption', async () => {
  const issuer = 'https://issuer.example', server = 'https://api.example/api/mcp';
  let authorization: URL | undefined, redeemed = 0;
  const provider = new CliAuth(redirectUrl, { read: async () => null, write: async () => {}, clear: async () => {} }, async url => { authorization = url; });
  const fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.includes('oauth-protected-resource')) return Response.json({ resource: server, authorization_servers: [issuer] });
    if (url.pathname.includes('oauth-authorization-server')) return Response.json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, registration_endpoint: `${issuer}/register`, response_types_supported: ['code'], grant_types_supported: ['authorization_code'], code_challenge_methods_supported: ['S256'], authorization_response_iss_parameter_supported: true });
    if (url.pathname === '/register') return Response.json({ client_id: 'test-client', redirect_uris: [redirectUrl], token_endpoint_auth_method: 'none' });
    if (url.pathname === '/token') {
      redeemed++;
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('code')).toBe('test-code');
      expect(body.get('redirect_uri')).toBe(redirectUrl);
      const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.get('code_verifier')!))).toString('base64url');
      expect(challenge).toBe(authorization?.searchParams.get('code_challenge') ?? 'missing challenge');
      return Response.json({ access_token: 'test-access', token_type: 'Bearer' });
    }
    return new Response(null, { status: 404 });
  };
  expect(await auth(provider, { serverUrl: server, fetchFn })).toBe('REDIRECT');
  const listener = await startLoginListener(() => provider.lastState);
  try {
    await expect(submitLoginInput(envelope(callback('wrong-state')))).rejects.toThrow('rejected');
    expect(redeemed).toBe(0);
    await submitLoginInput(envelope(callback(provider.lastState, issuer)));
    const params = await listener.callback;
    await expect(auth(provider, { serverUrl: server, authorizationCode: params.get('code')!, iss: 'https://wrong.example', fetchFn })).rejects.toThrow();
    expect(redeemed).toBe(0);
    expect(await auth(provider, { serverUrl: server, authorizationCode: params.get('code')!, iss: params.get('iss')!, fetchFn })).toBe('AUTHORIZED');
    expect(redeemed).toBe(1);
    expect(provider.tokens()?.access_token).toBe('test-access');
  } finally { await listener.close(); }
});
