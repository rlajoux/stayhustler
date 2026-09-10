const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml, csvCell, equalSecret, configErrors, databaseOptions } = require('../security');
test('admin HTML and spreadsheet exports treat customer values as data', () => {
    assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    for (const payload of ['=1+1','+cmd','-2','@SUM(A1)',' =cmd','\tcmd']) assert(csvCell(payload).startsWith('"\''));
    assert.equal(csvCell('a,b"c'), '"a,b""c"');
});
test('configuration has no default signing secret or permissive TLS', () => {
    assert(configErrors({}).some(error => error.includes('ACCESS_TOKEN_SECRET')));
    assert.equal(equalSecret(undefined, undefined), false);
    assert.equal(equalSecret('short', 'longer'), false);
    assert.equal(databaseOptions({ NODE_ENV: 'production' }).ssl.rejectUnauthorized, true);
});
