// Runs the Vite dev server and keeps this checkout in step with origin/main.
// Run with `npm run dev:sync`. Every DEV_SYNC_INTERVAL_SECONDS (default 30, minimum 5),
// it fetches origin/main. If this checkout is on main with no uncommitted changes and
// origin/main has new commits, it fast-forwards main, so Vite hot-reloads the change.
// It runs `npm install` only when package.json or package-lock.json changed.
// Anything else (another branch, local edits, diverged history) is logged and left alone.
import { execFile, spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';
const BRANCH = 'main';
const REMOTE_REF = `origin/${BRANCH}`;
const DEPENDENCY_FILES = new Set(['package.json', 'package-lock.json']);

function intervalSeconds() {
  const raw = process.env.DEV_SYNC_INTERVAL_SECONDS ?? '30';
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 5) {
    throw new Error(`DEV_SYNC_INTERVAL_SECONDS must be a number of at least 5, got "${raw}"`);
  }
  return seconds;
}

function stamp() {
  return new Date().toTimeString().slice(0, 8);
}

function firstLine(text) {
  return String(text ?? '').split('\n').find((line) => line.trim()) ?? 'unknown error';
}

// Runs a command and resolves with its output. Never rejects, so a failed git call
// shows up as ok: false instead of crashing the sync loop.
function run(file, args, { cwd = ROOT, shell = false, timeout = 120_000 } = {}) {
  return new Promise((resolvePromise) => {
    execFile(file, args, { cwd, shell, timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolvePromise({
        ok: !error,
        stdout: String(stdout ?? '').trim(),
        stderr: String(stderr ?? '').trim(),
        error,
      });
    });
  });
}

// Runs `npm install` with its output shown in the terminal. Resolves true on success.
function installDependencies(root) {
  return new Promise((resolvePromise) => {
    const child = spawn('npm', ['install'], { cwd: root, shell: IS_WIN, stdio: 'inherit' });
    child.on('exit', (code) => resolvePromise(code === 0));
    child.on('error', () => resolvePromise(false));
  });
}

// Builds one sync pass. The returned tick() can be called on a timer; overlapping calls are skipped.
export function createSyncer({ root = ROOT, log = console.log, install = installDependencies } = {}) {
  const git = (args) => run('git', args, { cwd: root });
  const isAncestor = async (ancestor, descendant) => (await git(['merge-base', '--is-ancestor', ancestor, descendant])).ok;

  let busy = false;
  let lastError = '';
  let lastNote = '';

  const note = (message) => log(`[dev-sync ${stamp()}] ${message}`);

  // Logs a message only when it differs from the last one, so a checkout that stays
  // behind does not print the same line every 30 seconds.
  const noteOnce = (key, message) => {
    if (key !== lastNote) {
      lastNote = key;
      note(message);
    }
  };

  async function sync() {
    const fetched = await git(['fetch', '--quiet', 'origin', BRANCH]);
    if (!fetched.ok) {
      const message = `fetch failed, will retry: ${firstLine(fetched.stderr || fetched.error?.message)}`;
      if (message !== lastError) {
        lastError = message;
        note(message);
      }
      return;
    }
    if (lastError) {
      lastError = '';
      note('fetch works again');
    }

    const [remoteResult, headResult, branchResult] = await Promise.all([
      git(['rev-parse', REMOTE_REF]),
      git(['rev-parse', 'HEAD']),
      git(['rev-parse', '--abbrev-ref', 'HEAD']),
    ]);
    if (!remoteResult.ok || !headResult.ok || !branchResult.ok) {
      note('could not read git state, will retry');
      return;
    }
    const remote = remoteResult.stdout;
    const head = headResult.stdout;
    const branch = branchResult.stdout;

    if (head === remote) return;

    if (branch !== BRANCH) {
      noteOnce(`${remote}:branch`, `origin/${BRANCH} has new commits, but this checkout is on "${branch}". Left as is.`);
      return;
    }

    if (await isAncestor(remote, head)) return; // Local main is ahead of origin. Nothing to pull.

    if (!(await isAncestor(head, remote))) {
      noteOnce(`${remote}:diverged`, `local ${BRANCH} has commits that origin/${BRANCH} lacks, so it cannot fast-forward. Left as is.`);
      return;
    }

    const dirty = await git(['status', '--porcelain', '--untracked-files=no']);
    if (dirty.stdout) {
      noteOnce(`${remote}:dirty`, `origin/${BRANCH} has updates, but there are uncommitted changes. Update waits until they are committed or stashed.`);
      return;
    }

    const changed = (await git(['diff', '--name-only', head, remote])).stdout.split('\n').filter(Boolean);
    const commitCount = (await git(['rev-list', '--count', `${head}..${remote}`])).stdout;

    const merged = await git(['merge', '--ff-only', '--quiet', remote]);
    if (!merged.ok) {
      note(`fast-forward failed, left as is: ${firstLine(merged.stderr || merged.error?.message)}`);
      return;
    }

    const shortHead = head.slice(0, 7);
    const shortRemote = remote.slice(0, 7);
    note(`updated ${BRANCH} ${shortHead} -> ${shortRemote} (${commitCount} commit${commitCount === '1' ? '' : 's'})`);

    if (changed.some((file) => DEPENDENCY_FILES.has(file))) {
      note('dependency files changed, running npm install');
      if (!(await install(root))) {
        note('npm install failed. Fix it, then restart dev:sync if the app errors.');
      }
    }
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      await sync();
    } catch (error) {
      note(`sync error, will retry: ${firstLine(error?.message)}`);
    } finally {
      busy = false;
    }
  }

  return { tick };
}

// npm starts a shell, which starts Vite. Signalling only npm can leave Vite running,
// so walk the tree and signal the children first.
function killTreePosix(pid) {
  const children = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }).stdout
    .split('\n')
    .map(Number)
    .filter(Boolean);
  for (const child of children) killTreePosix(child);
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Already exited.
  }
}

function killDevServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (IS_WIN) {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  } else {
    killTreePosix(child.pid);
  }
}

async function main() {
  const seconds = intervalSeconds();
  const syncer = createSyncer();

  console.log(`[dev-sync ${stamp()}] starting dev server; checking origin/${BRANCH} every ${seconds}s. Ctrl+C stops both.`);

  // Same terminal, so Ctrl+C reaches the dev server directly. The handler below covers a stop
  // sent only to this process.
  const dev = spawn('npm', ['run', 'dev'], { cwd: ROOT, shell: IS_WIN, stdio: 'inherit' });
  const timer = setInterval(() => syncer.tick(), seconds * 1000);

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    killDevServer(dev);
    setTimeout(() => process.exit(0), 3000).unref();
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  dev.on('exit', (code, signal) => {
    clearInterval(timer);
    process.exit(stopping ? 0 : (code ?? (signal ? 1 : 0)));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(`[dev-sync] ${error.message}`);
    process.exit(1);
  });
}
