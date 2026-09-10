const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const fs = require('node:fs');
const run = promisify(execFile);
const root = path.resolve(__dirname, '../..');

test('static deployment source, script syntax and CSP hashes are consistent', async () => {
    for (const [script, ...args] of [['scripts/check-site.js'], ['scripts/build-headers.js', '--check'], ['scripts/sync-public.js', '--check']]) {
        await run(process.execPath, [path.join(root, script), ...args]);
    }
    const shell = fs.readFileSync(path.join(root, 'api/results-shell.html'), 'utf8');
    assert(!shell.includes('.innerHTML'));
    assert(!shell.includes("localStorage.getItem('stayhustler_booking')"));
    assert(shell.includes("gtag('event', 'purchase', data.purchase)"));
});
test('sitemap validator checks every URL, follows bounded redirects and fails loops', async () => {
    let mode = 'ok'; let visited = 0; let base;
    const server = http.createServer((req, res) => {
        if (req.url === '/sitemap.xml') { res.setHeader('Content-Type', 'application/xml'); res.end(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}/one</loc></url><url><loc>${base}/two</loc></url></urlset>`); }
        else if (req.url === '/one') { visited++; res.end('one'); }
        else if (mode === 'loop') { res.writeHead(301, { Location: '/two' }); res.end(); }
        else if (req.url === '/two') { res.writeHead(308, { Location: '/final' }); res.end(); }
        else { visited++; res.end('two'); }
    }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    try {
        await run('bash', [path.join(root, 'scripts/validate-sitemap.sh'), base + '/sitemap.xml'], { timeout: 10000 });
        assert.equal(visited, 2);
        mode = 'loop';
        await assert.rejects(run('bash', [path.join(root, 'scripts/validate-sitemap.sh'), base + '/sitemap.xml'], { timeout: 10000 }), error => error.code === 1 && error.stdout.includes('[FAIL]'));
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
