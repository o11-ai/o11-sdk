import type { OAuthClientInformationContext, OAuthClientProvider, OAuthDiscoveryState, StoredOAuthClientInformation, StoredOAuthTokens } from '@modelcontextprotocol/client';
type Credentials = { clients: Record<string, StoredOAuthClientInformation>; tokens?: StoredOAuthTokens; discovery?: OAuthDiscoveryState };
export interface SecretStore { read(): Promise<string | null>; write(value: string): Promise<void>; clear(): Promise<void> }
export async function systemStore(profile: string, server: URL): Promise<SecretStore> {
  const { AsyncEntry } = await import('@napi-rs/keyring');
  const entry = new AsyncEntry('o11-cli', `${profile}:${server.href}`, { linux: { store: 'secret-service' } });
  return { read: async () => await entry.getPassword() ?? null, write: value => entry.setPassword(value), clear: async () => { await entry.deletePassword(); } };
}
export class CliAuth implements OAuthClientProvider {
  private saved: Credentials = { clients: {} };
  private verifier?: string;
  lastState?: string;
  constructor(readonly redirectUrl: string, private store: SecretStore, private authorize: (url: URL) => Promise<void>, private scopes = 'o11:read o11:configure o11:credentials') {}
  async load() {
    const raw = await this.store.read();
    if (raw) { const data: unknown = JSON.parse(raw); if (!data || typeof data !== 'object' || !('clients' in data)) throw new Error('Stored login is invalid. Run o11 logout, then login.'); this.saved = data as Credentials; }
    return this;
  }
  get clientMetadata() { return { client_name: 'o11 CLI', redirect_uris: [this.redirectUrl], application_type: 'native' as const, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: this.scopes }; }
  state() { this.lastState = crypto.randomUUID(); return this.lastState; }
  clientInformation(ctx?: OAuthClientInformationContext) { return ctx ? this.saved.clients[ctx.issuer] : undefined; }
  async saveClientInformation(value: StoredOAuthClientInformation, ctx?: OAuthClientInformationContext) { if (!ctx) throw new Error('Missing authorization issuer.'); this.saved.clients[ctx.issuer] = value; await this.persist(); }
  tokens() { return this.saved.tokens; }
  async saveTokens(value: StoredOAuthTokens) { this.saved.tokens = value; await this.persist(); }
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
