#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
let scripts = 0, pages = 0;
function visit(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (file.endsWith('.html')) {
            pages++;
            const html = fs.readFileSync(file, 'utf8');
            for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
                if (/application\/ld\+json/i.test(match[1])) JSON.parse(match[2]);
                else if (!/\bsrc=/i.test(match[1])) { new vm.Script(match[2], { filename: file }); scripts++; }
            }
            if (/\son(?:click|change|error|submit)\s*=/i.test(html)) throw new Error(`Inline handler violates CSP: ${file}`);
        }
    }
}
visit(path.join(root, 'public'));
const redirects = fs.readFileSync(path.join(root, 'public/_redirects'), 'utf8');
if (/^\/\S+\s+\/\S+\.html\s+30[1278]$/m.test(redirects)) throw new Error('Redirect to .html conflicts with Cloudflare pretty URLs');
const sitemap = fs.readFileSync(path.join(root, 'public/sitemap.xml'), 'utf8');
for (const match of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const route = decodeURI(new URL(match[1]).pathname);
    const candidates = [route, route + '.html', route.replace(/\/$/, '') + '/index.html'];
    if (!candidates.some(file => { const target = path.join(root, 'public', file); return fs.existsSync(target) && fs.statSync(target).isFile(); })) throw new Error(`Sitemap route has no file: ${route}`);
}
console.log(`${pages} HTML pages and ${scripts} inline scripts checked; sitemap files and redirect directions valid.`);
