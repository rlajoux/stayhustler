// Local browser QA only. Every provider is mocked; this never sends mail or charges money.
const { createApp } = require('../../server');
const { Pool } = require('pg');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
async function main() {
    if (!process.env.TEST_DATABASE_URL || !['localhost','127.0.0.1'].includes(new URL(process.env.TEST_DATABASE_URL).hostname)) throw new Error('A local TEST_DATABASE_URL is required');
    const bootstrap = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const schema = 'preview_' + crypto.randomBytes(6).toString('hex');
    await bootstrap.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    const sessions = new Map();
    const stripe = { webhooks: {}, checkout: { sessions: {
        create: async body => { const id = 'cs_test_' + crypto.randomBytes(8).toString('hex'); const session = { ...body, id, url: `https://checkout.stripe.com/c/pay/${id}`, amount_total: 700, currency: 'usd', livemode: false, payment_status: 'paid', payment_intent: 'pi_' + id }; sessions.set(id, session); return session; },
        retrieve: async id => sessions.get(id)
    } } };
    const env = { NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL, DATABASE_SSL: 'disable', STRIPE_SECRET_KEY: 'sk_test_local', STRIPE_WEBHOOK_SECRET: 'whsec_local', GEMINI_API_KEY: 'test', SENDGRID_API_KEY: 'test', SENDGRID_FROM_EMAIL: 'test@example.test', ACCESS_TOKEN_SECRET: 't'.repeat(40), UNSUBSCRIBE_SECRET: 'u'.repeat(40), ADMIN_USER: 'audit', ADMIN_PASS: 'test-only-password', API_BASE_URL: 'http://127.0.0.1:3000', PUBLIC_BASE_URL: 'http://127.0.0.1:8080' };
    const result = { email_subject: 'Late checkout on 15 October', email_body: 'Hello,\n\nReservation: [Confirmation Number]\n\nI am looking forward to my stay at โรงแรม Audit in Bangkok from 13 to 15 October. Would late checkout at 4pm be possible on 15 October? I understand this depends on availability and your policy. Please let me know about any charge, or whether luggage storage would be possible instead.\n\nThank you,\n[Your Name]', timing_guidance: ['Ask before arrival if the hotel accepts advance requests.', 'Confirm availability with reception during your stay.', 'If late checkout is unavailable, ask about luggage storage.'], fallback_script: 'Would it be possible to check out at 4pm today? I understand availability may be limited.' };
    const runtime = await createApp({ env, pool, stripe, generate: async () => ({ result, finalSource: 'first' }), sendMail: async () => {} });
    const checkout = await runtime.orders.checkout({ email: 'buyer@example.test', booking: { hotel: 'โรงแรม Audit', city: 'Bangkok', checkin: '2026-10-13', checkout: '2026-10-15' }, context: { requestType: 'late_checkout', flexibility_detail: '4pm', askPreference: 'both' } });
    const order = await runtime.orders.getOrder(checkout.order_id);
    await runtime.orders.verifySession(order.stripe_session_id); await runtime.orders.fulfil(order.id);
    // All ordinary checkout attempts in this browser fixture return a recoverable provider error.
    stripe.checkout.sessions.create = async () => { throw new Error('Mock checkout outage'); };
    const paid = await runtime.orders.getOrder(order.id);
    fs.writeFileSync('/private/tmp/stayhustler-qa-links.json', JSON.stringify({ recovery: runtime.orders.recoveryLink(paid) }));
    const stripTracking = html => html.replace(/<script[^>]+src=["'][^"']*(?:googletagmanager|crazyegg)[^>]*><\/script>/g, '');
    const apiWrapper = express();
    apiWrapper.use((req, res, next) => {
        const send = res.send.bind(res);
        res.send = body => send(typeof body === 'string' && body.startsWith('<!DOCTYPE') ? stripTracking(body) : body);
        next();
    });
    apiWrapper.use(runtime.app);
    const api = apiWrapper.listen(3000, '127.0.0.1');
    const staticApp = express();
    const publicRoot = path.resolve(__dirname, '../../../public');
    staticApp.use((req, res, next) => {
        const headers = fs.readFileSync(path.join(publicRoot, '_headers'), 'utf8');
        let route = '';
        for (const line of headers.split('\n')) {
            if (line.startsWith('/')) route = line;
            if ((route === req.path || route === '/*') && line.startsWith('  ')) {
                const split = line.indexOf(':');
                const key = line.slice(2, split); let value = line.slice(split + 1).trim();
                if (key === 'Content-Security-Policy') value = value.replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:3000");
                res.set(key, value);
            }
        }
        next();
    });
    staticApp.use((req, res, next) => {
        const route = req.path === '/' ? '/index.html' : req.path;
        const file = path.resolve(publicRoot, '.' + (path.extname(route) ? route : route + '.html'));
        if (file.startsWith(publicRoot + path.sep) && file.endsWith('.html') && fs.existsSync(file)) res.type('html').send(stripTracking(fs.readFileSync(file, 'utf8')));
        else next();
    });
    staticApp.use(express.static(publicRoot, { extensions: ['html'] }));
    const site = staticApp.listen(8080, '127.0.0.1', () => console.log('Local QA: http://127.0.0.1:8080/booking.html; mocked saved order link in /private/tmp/stayhustler-qa-links.json'));
    process.on('SIGINT', async () => { api.closeAllConnections(); site.closeAllConnections(); api.close(); site.close(); await pool.end(); await bootstrap.query(`DROP SCHEMA ${schema} CASCADE`); await bootstrap.end(); process.exit(0); });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
