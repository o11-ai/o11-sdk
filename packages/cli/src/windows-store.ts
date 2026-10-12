import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { configRoot } from './profile';
import type { SecretStore } from './vault';

// Windows PowerShell is included with supported Windows versions. Secrets travel
// through stdin, never arguments. ProtectedData uses user-bound DPAPI without UI.
const script = String.raw`
$ErrorActionPreference = 'Stop'
$utf8 = New-Object Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
Add-Type -AssemblyName System.Security
$inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
$directory = [IO.Path]::GetFullPath($inputData.directory)
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
function Assert-Private($path, $isDirectory) {
  $item = Get-Item -LiteralPath $path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.PSIsContainer -ne $isDirectory) { throw 'Invalid credential path' }
  $acl = Get-Acl -LiteralPath $path
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Invalid credential owner' }
  foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $rule.IdentityReference.Value -ne $sid.Value) { throw 'Credential access is not private' }
  }
}
if (-not [IO.Directory]::Exists($directory)) {
  $security = New-Object Security.AccessControl.DirectorySecurity
  $security.SetOwner($sid)
  $security.SetAccessRuleProtection($true, $false)
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $security.AddAccessRule($rule)
  [void][IO.Directory]::CreateDirectory($directory, $security)
}
Assert-Private $directory $true
$path = [IO.Path]::Combine($directory, $inputData.name)
$exists = Test-Path -LiteralPath $path
if ($exists) { Assert-Private $path $false }
switch ($inputData.action) {
  'read' {
    if (-not $exists) { [Console]::Out.Write('null'); break }
    if ((Get-Item -LiteralPath $path).Length -gt 1048576) { throw 'Credential file is too large' }
    $bytes = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($path), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    [Console]::Out.Write((ConvertTo-Json -InputObject ([Text.Encoding]::UTF8.GetString($bytes)) -Compress))
  }
  'write' {
    $bytes = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($inputData.value), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $temporary = $path + '.' + [Guid]::NewGuid().ToString() + '.tmp'
    try {
      $file = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
      try { $file.Write($bytes, 0, $bytes.Length); $file.Flush($true) } finally { $file.Dispose() }
      Assert-Private $temporary $false
      if ($exists) { [IO.File]::Replace($temporary, $path, $null) } else { [IO.File]::Move($temporary, $path) }
    } finally { if (Test-Path -LiteralPath $temporary) { [IO.File]::Delete($temporary) } }
    [Console]::Out.Write('null')
  }
  'clear' { if ($exists) { [IO.File]::Delete($path) }; [Console]::Out.Write('null') }
  default { throw 'Invalid credential operation' }
}`;

export function windowsStore(profile: string, server: URL): SecretStore {
  const name = createHash('sha256').update(JSON.stringify([profile, server.href])).digest('hex') + '.dpapi';
  const directory = join(configRoot(), 'credentials');
  const execute = (action: 'read' | 'write' | 'clear', value?: string): Promise<string | null> => new Promise((resolve, reject) => {
    const child = execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 15_000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
        if (error) { reject(new Error('Windows credential storage is unavailable or not private. Use a local user-owned config directory and retry.')); return; }
        try {
          const result: unknown = JSON.parse(stdout.replace(/^\uFEFF/, ''));
          if (result !== null && typeof result !== 'string') throw new Error('Invalid credential response.');
          resolve(result);
        } catch { reject(new Error('Windows credential storage returned an invalid response.')); }
      });
    child.stdin?.on('error', () => reject(new Error('Windows credential storage could not receive the request.')));
    child.stdin?.end(JSON.stringify({ action, directory, name, value }));
  });
  return { read: () => execute('read'), write: async value => { await execute('write', value); }, clear: async () => { await execute('clear'); } };
}
