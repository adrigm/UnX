'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ensureBundledExtractorExecutable } = require('../../scripts/prepare-launcher-payload.cjs');

test('a bundled Linux extractor unpacked as 0644 gets owner execute permission before spawning', async () => {
  const packageRoot = path.resolve('fixture-7zip-bin');
  const binary = path.join(packageRoot, 'linux', 'x64', '7za');
  const changes = [];
  const fs = {
    async lstat(file) {
      assert.equal(file, binary);
      return { mode: 0o100644, isFile: () => true, isSymbolicLink: () => false };
    },
    async chmod(file, mode) { changes.push({ file, mode }); },
  };
  assert.equal(await ensureBundledExtractorExecutable(binary, packageRoot, { platform: 'linux', fs }), true);
  assert.deepEqual(changes, [{ file: binary, mode: 0o744 }]);
});

test('extractor permission repair leaves Windows, PATH commands, and existing executable bits alone', async () => {
  const packageRoot = path.resolve('fixture-7zip-bin');
  const binary = path.join(packageRoot, 'linux', 'x64', '7za');
  let calls = 0;
  const fs = {
    async lstat() { calls++; return { mode: 0o100755, isFile: () => true, isSymbolicLink: () => false }; },
    async chmod() { assert.fail('An executable must not be chmodded again.'); },
  };
  assert.equal(await ensureBundledExtractorExecutable(binary, packageRoot, { platform: 'win32', fs }), false);
  assert.equal(await ensureBundledExtractorExecutable('7za', packageRoot, { platform: 'linux', fs }), false);
  assert.equal(calls, 0);
  assert.equal(await ensureBundledExtractorExecutable(binary, packageRoot, { platform: 'linux', fs }), false);
  assert.equal(calls, 1);
  await assert.rejects(ensureBundledExtractorExecutable(path.resolve('outside', '7za'), packageRoot, { platform: 'linux', fs }), /outside the bundled/);
});
