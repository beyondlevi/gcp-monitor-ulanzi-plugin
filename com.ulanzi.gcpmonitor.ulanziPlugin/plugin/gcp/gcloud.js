import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const isWin = process.platform === 'win32';
const TOKEN_TTL_MS = 50 * 60 * 1000;

const quoteWin = (s) => `"${String(s).replace(/"/g, '""')}"`;
const shortName = (url) => (typeof url === 'string' ? url.split('/').pop() : url);

let cachedBin = null;
const tokenCache = new Map();

const accountArgs = (account) => (account ? [`--account=${account}`] : []);
const tokenKey = (account) => account || '@default';

const candidatePaths = () => {
  const home = homedir();
  if (isWin) {
    const pf = process.env.ProgramFiles || 'C:/Program Files';
    const pfx86 = process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)';
    const localApp = process.env.LOCALAPPDATA || path.join(home, 'AppData/Local');
    return [
      path.join(pf, 'Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd'),
      path.join(pfx86, 'Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd'),
      path.join(localApp, 'Google/Cloud SDK/google-cloud-sdk/bin/gcloud.cmd'),
      path.join(home, 'google-cloud-sdk/bin/gcloud.cmd'),
    ];
  }
  return [
    '/usr/local/bin/gcloud',
    '/opt/homebrew/bin/gcloud',
    '/usr/bin/gcloud',
    '/snap/bin/gcloud',
    path.join(home, 'google-cloud-sdk/bin/gcloud'),
    path.join(home, '.local/bin/gcloud'),
  ];
};

const run = (bin, args, { timeoutMs = 20000 } = {}) =>
  new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const child = isWin
      ? spawn([quoteWin(bin), ...args.map(quoteWin)].join(' '), { windowsHide: true, shell: true })
      : spawn(bin, args, { windowsHide: true });

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* noop */
      }
      finish(resolve, { code: null, signal: 'TIMEOUT', stdout, stderr });
    }, timeoutMs);

    function finish(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    }

    child.stdout?.on('data', (d) => (stdout += d));
    child.stderr?.on('data', (d) => (stderr += d));
    child.on('error', (e) => finish(reject, e));
    child.on('close', (code, signal) => finish(resolve, { code, signal, stdout, stderr }));
  });

const resolveViaShell = async () => {
  try {
    if (isWin) {
      const { code, stdout } = await run('where', ['gcloud']);
      const first = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      return code === 0 && first && existsSync(first) ? first : null;
    }
    const shell = process.env.SHELL || '/bin/bash';
    const { code, stdout } = await run(shell, ['-lc', 'command -v gcloud']);
    const p = stdout.trim().split(/\r?\n/).pop();
    return code === 0 && p && existsSync(p) ? p : null;
  } catch {
    return null;
  }
};

const resolveGcloud = async (override) => {
  if (override && existsSync(override)) return override;
  const fromEnv = process.env.GCP_MONITOR_GCLOUD;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  if (cachedBin) return cachedBin;

  const found = candidatePaths().find((c) => existsSync(c));
  if (found) return (cachedBin = found);

  const viaShell = await resolveViaShell();
  if (viaShell) return (cachedBin = viaShell);

  return (cachedBin = isWin ? 'gcloud.cmd' : 'gcloud');
};

const gcloud = async (args, { override } = {}) => {
  const bin = await resolveGcloud(override);
  let result;
  try {
    result = await run(bin, args);
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      throw new Error('gcloud CLI not found. Install the Google Cloud SDK or set its path in the plugin settings.');
    }
    throw e;
  }
  if (result.code !== 0) {
    const msg = (result.stderr || result.stdout || '').trim();
    const err = new Error(msg || `gcloud exited with code ${result.code}${result.signal ? ` (${result.signal})` : ''}`);
    err.exitCode = result.code;
    throw err;
  }
  return result.stdout;
};

export const invalidateToken = (account) => {
  if (account === undefined) tokenCache.clear();
  else tokenCache.delete(tokenKey(account));
};

export const getAccessToken = async ({ account, override } = {}) => {
  const key = tokenKey(account);
  const now = Date.now();
  const cached = tokenCache.get(key);
  if (cached && now < cached.exp) return cached.token;
  const out = await gcloud(['auth', 'print-access-token', ...accountArgs(account)], { override });
  const token = out.trim();
  if (!token) throw new Error('Empty access token. Run: gcloud auth login');
  tokenCache.set(key, { token, exp: now + TOKEN_TTL_MS });
  return token;
};

export const listAccounts = async ({ override } = {}) => {
  const out = await gcloud(['auth', 'list', '--format=json'], { override });
  const arr = JSON.parse(out || '[]');
  return arr
    .filter((a) => a && a.account)
    .map((a) => ({ account: a.account, active: a.status === 'ACTIVE' }));
};

export const listProjects = async ({ account, override } = {}) => {
  const out = await gcloud(['projects', 'list', '--sort-by=projectId', '--format=json', ...accountArgs(account)], { override });
  const arr = JSON.parse(out || '[]');
  return arr.map((p) => ({ projectId: p.projectId, name: p.name || p.projectId }));
};

export const listInstances = async (projectId, { account, override } = {}) => {
  if (!projectId) return [];
  const out = await gcloud(
    ['compute', 'instances', 'list', `--project=${projectId}`, '--format=json', ...accountArgs(account)],
    { override },
  );
  const arr = JSON.parse(out || '[]');
  return arr
    .map((i) => ({
      id: String(i.id),
      name: i.name,
      zone: shortName(i.zone),
      status: i.status,
      machineType: shortName(i.machineType),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const listSqlInstances = async (projectId, { account, override } = {}) => {
  if (!projectId) return [];
  const out = await gcloud(
    ['sql', 'instances', 'list', `--project=${projectId}`, '--format=json', ...accountArgs(account)],
    { override },
  );
  const arr = JSON.parse(out || '[]');
  return arr
    .map((i) => ({
      id: i.name,
      name: i.name,
      zone: i.region || '',
      status: i.state || '',
      databaseVersion: i.databaseVersion || '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};
