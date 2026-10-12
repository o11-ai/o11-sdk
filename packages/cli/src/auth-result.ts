import { object } from './http-client';

export function authenticatedResult(value: unknown, profile: string, credentialStore: string) {
  const authentication = { status: 'authenticated', profile, credentialStore };
  if (!object(value)) return { result: value, authentication };
  return object(value.result) ? { ...value, result: { ...value.result, authentication } } : { ...value, authentication };
}
