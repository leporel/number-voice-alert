// Assembles dist/: only the files the extension needs at runtime, ready to be zipped for the Chrome Web Store.
// Usage: bun tools/build-dist.ts
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

interface Manifest {
  version: string;
  default_locale?: string;
  background: { service_worker: string };
  action?: { default_popup?: string; default_icon?: Record<string, string> };
  icons?: Record<string, string>;
  content_scripts?: { js?: string[]; css?: string[] }[];
}

const ROOT = resolve(import.meta.dir, '..');
const DIST = join(ROOT, 'dist');
// What the browser loads plus the license; docs, tools and repository files stay out of the package.
const INCLUDE = ['manifest.json', '_locales', 'icons', 'src', 'LICENSE'];
const JUNK = new Set(['Thumbs.db', 'Desktop.ini', '.DS_Store']);

/** Paths the manifest points to directly: a missing one makes Chrome reject the package. */
function referencedFiles(manifest: Manifest): string[] {
  const { action = {} } = manifest;
  const paths = [
    manifest.background.service_worker,
    action.default_popup,
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(action.default_icon ?? {}),
    ...(manifest.content_scripts ?? []).flatMap((s) => [...(s.js ?? []), ...(s.css ?? [])]),
  ];
  if (manifest.default_locale) paths.push(`_locales/${manifest.default_locale}/messages.json`);
  return paths.filter((p): p is string => Boolean(p));
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

const isFile = (path: string) => existsSync(path) && statSync(path).isFile();

const manifest: Manifest = await Bun.file(join(ROOT, 'manifest.json')).json();

const missing = INCLUDE.filter((name) => !existsSync(join(ROOT, name)));
if (missing.length) fail(`not found in the project: ${missing.join(', ')}`);

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST);
for (const name of INCLUDE) {
  cpSync(join(ROOT, name), join(DIST, name), { recursive: true, filter: (src) => !JUNK.has(basename(src)) });
}

const broken = referencedFiles(manifest).filter((path) => !isFile(join(DIST, path)));
if (broken.length) fail(`manifest references files missing from dist: ${broken.join(', ')}`);

console.log(`Built ${relative(ROOT, DIST)}/ for version ${manifest.version}. Zip its contents, not the folder itself.`);
