const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const directory = path.resolve('dist/bs-crafttools/browser');
const indexPath = path.join(directory, 'index.html');
const scriptUrlGlobal = 'globalThis.__bsCrafttoolsFileScriptUrl';

function convertModuleScript(source, resolveDir, sourcefile) {
  const usesImportMetaUrl = source.includes('import.meta.url');
  if (source.replace(/\bimport\.meta\.url\b/g, '').includes('import.meta')) {
    throw new Error(`Unsupported import.meta usage in ${sourcefile}; only import.meta.url can be resolved for a file build.`);
  }
  const result = esbuild.buildSync({
    stdin: { contents: source, resolveDir, sourcefile },
    bundle: true,
    format: 'iife',
    write: false,
    minify: true,
    logOverride: { 'empty-import-meta': 'error' },
    ...(usesImportMetaUrl ? {
      define: { 'import.meta.url': scriptUrlGlobal },
      banner: { js: `${scriptUrlGlobal} = document.currentScript.src;` }
    } : {})
  });
  const output = result.outputFiles[0].text;
  if (/\bimport\.meta\b/.test(output)) {
    throw new Error(`Unsupported import.meta usage remains in ${sourcefile} after file-build conversion.`);
  }
  return output;
}

function prepareFileBuild() {
  let html = fs.readFileSync(indexPath, 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+\.js)" type="module"><\/script>/g)];
  if (!scripts.length) throw new Error('No module scripts found in the production index');

  for (const [tag, src] of scripts) {
    const file = path.join(directory, src);
    const source = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, convertModuleScript(source, directory, path.basename(file)));
    html = html.replace(tag, `<script src="${src}" defer></script>`);
  }
  fs.writeFileSync(indexPath, html);
}

if (require.main === module) prepareFileBuild();

module.exports = { convertModuleScript, prepareFileBuild };