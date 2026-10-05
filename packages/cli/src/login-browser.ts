import { execFile } from 'node:child_process';

export function remoteLoginEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY || env.CODESPACES || env.REMOTE_CONTAINERS || env.CI || (process.platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY));
}

export async function openLoginBrowser(url: URL, noBrowser = false) {
  const instructions = () => process.stderr.write(`Open this sign-in link in your browser:\n${url.href}\nKeep this login running. If your browser is on another computer, approve access and copy the sign-in code. In a second terminal or your coding agent here, pass it to o11 login --input FILE or --input - using standard input. Do not put the code in command arguments.\n`);
  if (noBrowser || remoteLoginEnvironment()) { instructions(); return; }
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url.href] : [url.href];
  await new Promise<void>(resolve => { execFile(command, args, error => { if (error) instructions(); resolve(); }); });
}
