import type { SecretStore } from './vault';

/** Keep the current grant available until explicit login completes. Caller holds its lock. */
export async function withLoginCredentials<T>(store: SecretStore, action: (pending: SecretStore) => Promise<T>): Promise<T> {
  let staged = await store.read();
  const pending: SecretStore = {
    read: async () => staged,
    write: async value => { staged = value; },
    clear: async () => { staged = null; },
  };
  const result = await action(pending);
  if (staged === null) await store.clear(); else await store.write(staged);
  return result;
}
