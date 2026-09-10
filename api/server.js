require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');
const crypto = require('node:crypto');
const Stripe = require('stripe');
const sgMail = require('@sendgrid/mail');
const { initialiseOrders, createOrderService } = require('./orders');
const { registerOrderRoutes } = require('./order-routes');
const { registerAdmin } = require('./admin');
const { generateRequestPayload } = require('./generation');
const { cleanEmail } = require('./validation');
const { equalSecret, limiter, configErrors, databaseOptions } = require('./security');

async function createApp({ env = process.env, pool: suppliedPool, stripe: suppliedStripe, generate = generateRequestPayload, sendMail: suppliedMail } = {}) {
    const errors = configErrors(env);
    if (errors.length) throw new Error(errors.join('; '));
    const pool = suppliedPool || new Pool(databaseOptions(env));
    pool.on('error', () => console.error('[DB] Idle connection failed; pool will reconnect'));
    const stripe = suppliedStripe || new Stripe(env.STRIPE_SECRET_KEY, { timeout: 10000, maxNetworkRetries: 2 });
    if (!suppliedMail) {
        sgMail.setApiKey(env.SENDGRID_API_KEY);
        sgMail.client.setDefaultRequest('timeout', 10000);
    }
    const sendMail = suppliedMail || (message => sgMail.send(message));
    const apiBase = (env.API_BASE_URL || 'https://app.stayhustler.com').replace(/\/$/, '');
    const siteBase = (env.PUBLIC_BASE_URL || 'https://stayhustler.com').replace(/\/$/, '');
    await pool.query(`CREATE TABLE IF NOT EXISTS newsletter_subscribers (
        id SERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, source TEXT NOT NULL DEFAULT 'unknown',
        status TEXT NOT NULL DEFAULT 'subscribed', created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        unsubscribed_at TIMESTAMPTZ, last_ip TEXT, user_agent TEXT);
        CREATE TABLE IF NOT EXISTS request_deliveries (
        id SERIAL PRIMARY KEY,email TEXT NOT NULL,booking JSONB NOT NULL,context JSONB NOT NULL,generated JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'sent',error TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
        CREATE TABLE IF NOT EXISTS page_views (id SERIAL PRIMARY KEY,page TEXT NOT NULL,session_id TEXT,referrer TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
        CREATE TABLE IF NOT EXISTS request_limits (key TEXT PRIMARY KEY,hits INTEGER NOT NULL,expires_at TIMESTAMPTZ NOT NULL);`);
    await initialiseOrders(pool);
    const orders = createOrderService({ pool, stripe, generate, sendMail, secret: env.ACCESS_TOKEN_SECRET, fromEmail: env.SENDGRID_FROM_EMAIL, apiBase, siteBase, liveMode: env.STRIPE_SECRET_KEY.startsWith('sk_live_') });
    const app = express();
    app.locals.pool = pool;
    app.locals.orders = orders;
    // Railway has one ingress proxy. Set explicit proxy CIDRs when the topology differs.
    app.set('trust proxy', env.TRUST_PROXY ? env.TRUST_PROXY.split(',').map(value => value.trim()) : 1);
    app.disable('x-powered-by');
    app.use((req, res, next) => {
        const nonce = crypto.randomBytes(18).toString('base64');
        res.locals.nonce = nonce;
        res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex, nofollow',
            'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy': `default-src 'self'; script-src 'nonce-${nonce}' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://*.google-analytics.com https://www.googletagmanager.com; connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'` });
        next();
    });
    app.use(cors({ origin: [siteBase, apiBase], credentials: true, methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type'], maxAge: 600 }));
    // Signature verification must see the original bytes, before express.json().
    app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '256kb' }), async (req, res) => {
        let event;
        try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], env.STRIPE_WEBHOOK_SECRET); }
        catch { return res.status(400).json({ error: 'Invalid webhook signature' }); }
        try { await orders.webhook(event); res.json({ received: true }); }
        catch { console.error('[Payment] Webhook processing failed', { event_id: event.id }); res.status(503).json({ error: 'Retry this event' }); }
    });
    app.use(express.json({ limit: '16kb' }));
    app.use(cookieParser());
    app.use((req, res, next) => {
        if (req.method === 'POST' && req.headers.origin && ![siteBase, apiBase].includes(req.headers.origin)) return res.status(403).json({ error: 'Origin not allowed' });
        next();
    });
    const rateLimit = limiter(pool, 'orders', 30, 900);
    const resendRateLimit = limiter(pool, 'resend', 5, 3600);
    const adminLimit = limiter(pool, 'admin', 100, 900);
    function basicAuth(req, res, next) {
        if (!env.ADMIN_USER || !env.ADMIN_PASS) return res.status(503).send('Admin access not configured');
        const decoded = req.headers.authorization?.startsWith('Basic ') ? Buffer.from(req.headers.authorization.slice(6), 'base64').toString() : '';
        const split = decoded.indexOf(':');
        if (!equalSecret(decoded.slice(0, split), env.ADMIN_USER) || !equalSecret(decoded.slice(split + 1), env.ADMIN_PASS)) {
            return adminLimit(req, res, () => res.set('WWW-Authenticate', 'Basic realm="StayHustler Admin"').status(401).send('Unauthorised'));
        }
        next();
    }
    const handle = action => async (req, res) => {
        try { await action(req, res); }
        catch (error) { console.error('[API] Request failed', { status: error.status || 503 }); res.status(error.status || 503).json({ error: error.status ? error.message : 'Service temporarily unavailable' }); }
    };
    registerOrderRoutes(app, { orders, secret: env.ACCESS_TOKEN_SECRET, siteBase, basicAuth, rateLimit, resendRateLimit, secureCookies: env.NODE_ENV === 'production', nonceForResponse: res => res.locals.nonce });
    registerAdmin(app, { pool, orders, basicAuth, handle, adminPath: env.ADMIN_PATH || '/admin' });

    app.post('/api/subscribe', limiter(pool, 'subscribe', 5, 3600), handle(async (req, res) => {
        const email = cleanEmail(req.body.email);
        const source = typeof req.body.source === 'string' && /^[a-zA-Z0-9_-]{1,60}$/.test(req.body.source) ? req.body.source : 'unknown';
        await pool.query(`INSERT INTO newsletter_subscribers (email,source) VALUES($1,$2)
            ON CONFLICT(email) DO UPDATE SET status='subscribed',unsubscribed_at=NULL,last_ip=NULL,user_agent=NULL`, [email, source]);
        res.json({ ok: true });
    }));
    app.get('/api/subscribers/count', basicAuth, handle(async (req, res) => {
        res.json((await pool.query("SELECT COUNT(*)::int AS count FROM newsletter_subscribers WHERE status='subscribed'")).rows[0]);
    }));
    app.get('/api/subscribers/status', basicAuth, handle(async (req, res) => {
        res.json((await pool.query("SELECT COUNT(*) FILTER(WHERE status='subscribed')::int AS subscribed,COUNT(*) FILTER(WHERE status='unsubscribed')::int AS unsubscribed FROM newsletter_subscribers")).rows[0]);
    }));
    app.get('/unsubscribe', handle(async (req, res) => {
        const email = cleanEmail(req.query.email);
        const expected = crypto.createHmac('sha256', env.UNSUBSCRIBE_SECRET).update(email).digest('hex');
        if (!equalSecret(req.query.token, expected)) return res.status(400).type('text').send('Invalid unsubscribe link');
        await pool.query("UPDATE newsletter_subscribers SET status='unsubscribed',unsubscribed_at=now(),last_ip=NULL,user_agent=NULL WHERE email=$1", [email]);
        res.type('text').send('You have been unsubscribed from the StayHustler newsletter.');
    }));
    app.post('/api/track', limiter(pool, 'track', 120, 900), handle(async (req, res) => {
        const { page, session_id } = req.body;
        if (!['index','booking','context','preview','payment','results'].includes(page)) return res.status(400).json({ error: 'Invalid page' });
        if (session_id !== undefined && (typeof session_id !== 'string' || session_id.length > 100)) return res.status(400).json({ error: 'Invalid session' });
        await pool.query('INSERT INTO page_views(page,session_id) VALUES($1,$2)', [page, session_id || null]);
        res.json({ ok: true });
    }));
    async function report() {
        const stats = await orders.statistics();
        if (env.REPORT_EMAIL) await sendMail({ to: env.REPORT_EMAIL, from: env.SENDGRID_FROM_EMAIL,
            subject: `StayHustler: ${stats.paid_orders} paid orders in the last 24 hours`,
            text: `Orders paid in the last 24 hours (UTC rolling window). Amounts in cents. Refunds refer to this purchase cohort, not refunds processed today. Free orders are separate. Page views are not conversions.\n\n${JSON.stringify(stats, null, 2)}` });
        return stats;
    }
    app.get('/api/cron/hourly-report', handle(async (req, res) => {
        if (!env.CRON_SECRET) return res.status(503).json({ error: 'Scheduled endpoint is not configured' });
        if (!equalSecret(req.headers['x-cron-secret'], env.CRON_SECRET)) return res.status(401).json({ error: 'Unauthorised' });
        res.json({ ok: true, statistics: await report() });
    }));
    app.get(['/health','/api/health'], (req, res) => res.json({ ok: true }));
    app.get('/version', (req, res) => res.json({ revision: env.RAILWAY_GIT_COMMIT_SHA || env.BUILD_REVISION || 'development' }));
    app.get('/ready', handle(async (req, res) => {
        await pool.query('SELECT id FROM orders LIMIT 0');
        res.json({ ok: true, database: 'ready', providers: 'configured' });
    }));
    app.get('/robots.txt', (req, res) => res.type('text').send('User-agent: *\nDisallow: /\n'));
    app.get('/', (req, res) => res.redirect(siteBase));
    app.use((error, req, res, next) => { // Express parser errors must not disclose stack traces.
        if (res.headersSent) return next(error);
        res.status(error.status || 500).json({ error: error.status === 413 ? 'Request too large' : 'Invalid request' });
    });
    async function dailyJob(name, action) {
        const connection = await pool.connect();
        let locked = false;
        try {
            locked = (await connection.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [name])).rows[0].locked;
            if (!locked) return;
            const due = (await connection.query("SELECT 1 FROM operational_jobs WHERE name=$1 AND last_run>now()-INTERVAL '24 hours'", [name])).rowCount === 0;
            if (!due) return;
            await action();
            await connection.query('INSERT INTO operational_jobs VALUES($1,now()) ON CONFLICT(name) DO UPDATE SET last_run=now()', [name]);
        } finally {
            try { if (locked) await connection.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [name]); }
            finally { connection.release(); }
        }
    }
    let running = false;
    async function tick() {
        if (running) return;
        running = true;
        try {
            await orders.processPending();
            await dailyJob('retention', async () => {
                await orders.expireData();
                await pool.query('DELETE FROM request_limits WHERE expires_at<now()');
                await pool.query("UPDATE newsletter_subscribers SET last_ip=NULL,user_agent=NULL WHERE last_ip IS NOT NULL OR user_agent IS NOT NULL");
            });
            if (env.REPORT_EMAIL) await dailyJob('daily-report', report);
        } catch { console.error('[Worker] Work deferred until next attempt'); }
        finally { running = false; }
    }
    return { app, pool, orders, tick };
}

if (require.main === module) {
    createApp().then(({ app, tick }) => {
        app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
            console.log('StayHustler API ready');
            void tick();
            setInterval(() => void tick(), 15000).unref();
        });
    }).catch(error => { console.error('Startup failed:', error.message); process.exitCode = 1; });
}
module.exports = { createApp };
