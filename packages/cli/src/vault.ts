import type { OAuthClientInformationContext, OAuthClientProvider, OAuthDiscoveryState, StoredOAuthClientInformation, StoredOAuthTokens } from '@modelcontextprotocol/client';
import type { CredentialMode } from './profile';
import { coordinatedAuth } from './coordinated-auth';
import { withCredentialLock } from './credential-lock';
import { fileStore } from './file-store';
import { z } from 'zod';
type Credentials = { clients: Record<string, StoredOAuthClientInformation>; tokens?: StoredOAuthTokens; discovery?: OAuthDiscoveryState };
const storedCredentials = z.object({
  clients: z.record(z.string(), z.object({ client_id: z.string().min(1), issuer: z.string().optional() }).loose()),
  tokens: z.object({ access_token: z.string().min(1), token_type: z.string().min(1), refresh_token: z.string().optional(), scope: z.string().optional(), expires_in: z.number().optional(), issuer: z.string().optional() }).loose().optional(),
  discovery: z.object({ authorizationServerUrl: z.string().url(), authorizationServerMetadata: z.record(z.string(), z.unknown()).optional(), resourceMetadata: z.record(z.string(), z.unknown()).optional(), resourceMetadataUrl: z.string().url().optional() }).loose().optional(),
});
export interface SecretStore { read(): Promise<string | null>; write(value: string): Promise<void>; clear(): Promise<void>; exclusive?<T>(action: () => Promise<T>): Promise<T> }
export class LoginRequiredError extends Error {
  constructor() { super('Sign-in or additional consent is required. Run o11 login.'); }
}
export async function credentialStore(profile: string, server: URL, mode: CredentialMode = 'keyring'): Promise<SecretStore> {
  if (mode === 'file') return { ...await fileStore(profile, server), exclusive: action => withCredentialLock(profile, server, mode, action) };
  const unavailable = () => new Error('The OS keyring is unavailable. Unlock it and retry, or explicitly use --credential-store file for private local credential storage.');
  let store: SecretStore;
  try { store = await systemStore(profile, server); } catch { throw unavailable(); }
  return {
    exclusive: action => withCredentialLock(profile, server, mode, action),
    read: async () => { try { return await store.read(); } catch { throw unavailable(); } },
    write: async value => { try { await store.write(value); } catch { throw unavailable(); } },
    clear: async () => { try { await store.clear(); } catch { throw unavailable(); } },
  };
}
export async function systemStore(profile: string, server: URL): Promise<SecretStore> {
  const { AsyncEntry } = await import('@napi-rs/keyring');
  const entry = new AsyncEntry('o11-cli', `${profile}:${server.href}`, { linux: { store: 'secret-service' } });
  return { read: async () => await entry.getPassword() ?? null, write: value => entry.setPassword(value), clear: async () => { await entry.deletePassword(); } };
}
export class CliAuth implements OAuthClientProvider {
  private saved: Credentials = { clients: {} };
  private verifier?: string;
  lastState?: string;
  constructor(readonly redirectUrl: string, private store: SecretStore, private authorize: (url: URL) => Promise<void>, private scopes = 'o11:read o11:configure o11:publish o11:send o11:credentials', private loginState?: string) {}
  async load() {
    const raw = await this.store.read();
    this.saved = { clients: {} };
    if (raw) {
      let data: unknown;
      try { data = JSON.parse(raw); } catch { throw new Error('Stored login is invalid. Run o11 logout, then login.'); }
      if (!storedCredentials.safeParse(data).success) throw new Error('Stored login is invalid. Run o11 logout, then login.');
      this.saved = data as Credentials;
    }
    return this;
  }
  exclusive<T>(action: () => Promise<T>): Promise<T> { return this.store.exclusive ? this.store.exclusive(action) : action(); }
  transportAuth() { return coordinatedAuth(this); }
  get clientMetadata() { return { client_name: 'o11 CLI', redirect_uris: [this.redirectUrl], application_type: 'native' as const, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: this.scopes }; }
  state() { this.lastState = this.loginState ?? crypto.randomUUID(); return this.lastState; }
  clientInformation(ctx?: OAuthClientInformationContext) { return ctx ? this.saved.clients[ctx.issuer] : undefined; }
  async saveClientInformation(value: StoredOAuthClientInformation, ctx?: OAuthClientInformationContext) { if (!ctx) throw new Error('Missing authorization issuer.'); this.saved.clients[ctx.issuer] = value; await this.persist(); }
  tokens() { return this.saved.tokens; }
  async saveTokens(value: StoredOAuthTokens) {
    const previous = this.saved.tokens?.issuer === value.issuer ? this.saved.tokens : undefined;
    this.saved.tokens = { ...value, refresh_token: value.refresh_token ?? previous?.refresh_token, scope: value.scope ?? previous?.scope };
    await this.persist();
  }
  redirectToAuthorization(url: URL) { return this.authorize(url); }
  saveCodeVerifier(value: string) { this.verifier = value; }
  codeVerifier() { if (!this.verifier) throw new Error('Login expired. Run o11 login again.'); return this.verifier; }
  discoveryState() { return this.saved.discovery; }
  async saveDiscoveryState(value: OAuthDiscoveryState) { this.saved.discovery = value; await this.persist(); }
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all') { this.saved = { clients: {} }; this.verifier = undefined; }
    else if (scope === 'client') this.saved.clients = {};
    else if (scope === 'verifier') this.verifier = undefined;
    else if (scope === 'tokens') delete this.saved.tokens;
    else delete this.saved.discovery;
    await this.persist();
  }
  private persist() { return this.store.write(JSON.stringify(this.saved)); }
}
