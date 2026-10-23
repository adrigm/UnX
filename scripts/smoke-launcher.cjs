'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
async function main() {
  const output = path.join(root, 'artifacts', 'launcher');
  await fs.mkdir(output, { recursive: true });
  const packaged = process.argv.includes('--packaged');
  let executable;
  let args = [];
  if (packaged) {
    const extension = process.platform === 'win32' ? '.exe' : '.AppImage';
    const files = (await fs.readdir(output)).filter((name) => name.startsWith('UnX-Manager-') && name.endsWith(extension));
    if (files.length !== 1) throw new Error('Expected exactly one packaged manager for this platform.');
    executable = path.join(output, files[0]);
    if (process.platform === 'linux') await fs.chmod(executable, 0o755);
  } else {
    const requireLauncher = createRequire(path.join(root, 'launcher', 'package.json'));
    executable = requireLauncher('electron');
    args.push(path.join(root, 'launcher'));
  }
  args.push('--smoke-test');
  // Only the isolated hosted Linux smoke test needs this flag. Released apps
  // keep Electron's renderer sandbox enabled during normal operation.
  if (process.platform === 'linux' && process.env.CI) args.push('--no-sandbox');
  const report = path.join(output, `smoke-${process.platform}-${Date.now()}.json`);
  const status = await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root, stdio: 'inherit',
      env: { ...process.env, UNX_SMOKE_REPORT: report, APPIMAGE_EXTRACT_AND_RUN: '1' }
    });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('The GUI did not finish its smoke test.')); }, 60000);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code) => { clearTimeout(timeout); resolve(code); });
  });
  if (status !== 0) throw new Error(`The GUI exited with status ${status}.`);
  const result = JSON.parse(await fs.readFile(report, 'utf8'));
  if (!result.success || !result.payloadAvailable || (packaged && !result.packaged)) throw new Error('The GUI did not validate its bundled settings and installation package.');
  console.log(`GUI smoke test passed: ${result.settings} settings, ${result.renderedControls} controls, ${result.platform}, packaged=${result.packaged}.`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
