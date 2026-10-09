export type SetupConnection = {
  organizationId: string;
  organizationName?: string;
  account?: { id: string; name?: string; email?: string };
};

export function setupConnectionContext(input: SetupConnection) {
  return [
    `Workspace: ${input.organizationId}`,
    input.organizationName ? `Workspace name: ${input.organizationName}` : '',
    input.account ? `Account: ${[input.account.name, input.account.email].filter(Boolean).join(' · ') || input.account.id}\nAccount ID: ${input.account.id}` : '',
  ].filter(Boolean).join('\n');
}

export const setupConnectionCheck = 'Before changes, state the connected account (name, email, ID), workspace (name, ID), and server from live o11 status or o11_setup. Compare them with this handoff. If any conflict, show expected and actual values and ask which connection to use before dependent work. Do not edit another workspace or create a replacement routine. Missing identity must be clarified, not guessed.';
