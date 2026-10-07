/** Stable CLI names; operation paths remain the server's reviewed API identifiers. */
const groups: Record<string, string> = {
  routines: 'engagement.routines', personas: 'engagement.personas', surveys: 'engagement.surveys',
  customers: 'engagement.customers', inbox: 'engagement.inbox', knowledge: 'engagement.knowledge',
  channels: 'engagement.channelSetup', replies: 'engagement.replies', templates: 'engagement.messageTemplates',
  tracking: 'signals.tracking', database: 'signals.database', identities: 'signals.identities',
};
export const kebab = (value: string) => value.replace(/[a-z0-9][A-Z]/g, pair => `${pair[0]}-${pair[1]}`).toLowerCase();
// OAuth is one published CLI token, but retains its established API casing.
const camel = (value: string) => value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()).replace(/Oauth(?=[A-Z]|$)/g, 'OAuth');
export function commandName(path: string): string {
  for (const [name, prefix] of Object.entries(groups)) if (path.startsWith(`${prefix}.`)) return [name, ...path.slice(prefix.length + 1).split('.').map(kebab)].join(' ');
  return path.split('.').map(kebab).join(' ');
}
export function commandPath(words: string[]): string {
  const [group, ...rest] = words;
  if (!group || words.some(word => !/^[a-z][a-z0-9-]*$/.test(word))) throw new Error('Use a command from o11 commands.');
  return [Object.hasOwn(groups, group) ? groups[group] : camel(group), ...rest.map(camel)].join('.');
}
