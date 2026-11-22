const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const directory = path.resolve('dist/bs-crafttools/browser');
const indexPath = path.join(directory, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+\.js)" type="module"><\/script>/g)];
if (!scripts.length) throw new Error('No module scripts found in the production index');

for (const [tag, src] of scripts) {
  const file = path.join(directory, src);
  const result = esbuild.buildSync({ entryPoints: [file], bundle: true, format: 'iife', write: false, minify: true });
  fs.writeFileSync(file, result.outputFiles[0].contents);
  html = html.replace(tag, `<script src="${src}" defer></script>`);
}
fs.writeFileSync(indexPath, html);