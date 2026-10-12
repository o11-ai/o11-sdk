import { spawn } from 'node:child_process';

export function remoteLoginEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY || env.CODESPACES || env.REMOTE_CONTAINERS || env.CI || (process.platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY));
}

export async function openLoginBrowser(url: URL, noBrowser = false) {
  const instructions = () => process.stderr.write(`Open this sign-in link in your browser:\n${url.href}\nKeep this login running. After you approve access, sign-in continues automatically here. If the server needs a compatibility fallback, use the approval page's sign-in code with o11 login --input FILE|- on this host.\n`);
  if (noBrowser || remoteLoginEnvironment()) { instructions(); return; }
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url.href] : [url.href];
  await new Promise<void>(resolve => {
    // Some Linux launchers remain alive with the browser. Start the handoff as
    // soon as the launcher starts, and let the browser outlive the CLI.
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', () => { instructions(); resolve(); });
    child.once('spawn', () => { child.unref(); resolve(); });
    child.once('exit', code => { if (code !== 0) instructions(); });
  });
}
