const assert = require('node:assert/strict');
const test = require('node:test');
const { convertModuleScript } = require('./prepare-file-build.cjs');

test('preserves the module script URL as the base for local-file worker URLs', () => {
  const output = convertModuleScript(
    'const workerUrl = new URL("worker-XGDNUYCS.js", import.meta.url);',
    process.cwd(),
    'main.js'
  );

  assert.match(output, /globalThis\.__bsCrafttoolsFileScriptUrl\s*=\s*document\.currentScript\.src/);
  assert.match(output, /new URL\("worker-XGDNUYCS\.js",globalThis\.__bsCrafttoolsFileScriptUrl\)/);
  assert.doesNotMatch(output, /\bimport\.meta\b/);
});

test('fails rather than erasing unsupported import.meta expressions', () => {
  assert.throws(
    () => convertModuleScript('const workerUrl = import.meta.resolve("./worker.js");', process.cwd(), 'main.js'),
    /import\.meta/
  );
});