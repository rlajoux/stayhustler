#!/usr/bin/env node
// public/ is the deploy source. Root files are generated mirrors for legacy previews.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const check = process.argv.includes('--check');
let mismatches = 0;
function sync(folder) {
    for (const entry of fs.readdirSync(path.join(root, 'public', folder), { withFileTypes: true })) {
        const relative = path.join(folder, entry.name);
        if (entry.isDirectory()) { sync(relative); continue; }
        const source = path.join(root, 'public', relative), target = path.join(root, relative);
        const bytes = fs.readFileSync(source);
        if (!fs.existsSync(target) || !bytes.equals(fs.readFileSync(target))) {
            if (check) { console.error(`Stale mirror: ${relative}`); mismatches++; }
            else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes); }
        }
    }
}
sync('');
if (mismatches) process.exitCode = 1;
