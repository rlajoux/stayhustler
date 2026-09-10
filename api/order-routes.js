const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const { couponPrice, PRICE_CENTS } = require('./orders');

/** Register order-owned operations; no client booking or recipient can override a paid order. */
function registerOrderRoutes(app, { orders, secret, siteBase, basicAuth, rateLimit, resendRateLimit, secureCookies, nonceForResponse }) {
    const handle = action => async (req, res) => {
        try { await action(req, res); }
        catch (error) {
            const status = error.status || 503;
            console.error('[Orders] Request failed', { code: error.code || status });
            res.status(status).json({ error: status < 500 ? error.message : 'Service temporarily unavailable. Please retry or use your order recovery link.', code: error.code || 'request_failed' });
        }
    };
    function setAccess(res, order) {
        const token = jwt.sign({ oid: order.id, purpose: 'access' }, secret, { expiresIn: '60m', issuer: 'stayhustler', audience: 'results' });
        res.cookie('sh_access', token, { httpOnly: true, secure: secureCookies, sameSite: 'lax', maxAge: 3600000, path: '/' });
    }
    function verify(token, purpose) {
        const decoded = jwt.verify(token, secret, { algorithms: ['HS256'], issuer: 'stayhustler', audience: 'results' });
        if (decoded.purpose !== purpose || typeof decoded.oid !== 'string') throw new Error('Invalid access token');
        return decoded;
    }
    async function access(req, res, next) {
        try {
            const decoded = verify(req.cookies.sh_access, 'access');
            const order = await orders.getOrder(decoded.oid);
            if (!order || !['paid', 'free'].includes(order.payment_status) || new Date(order.expires_at) <= new Date()) throw new Error('Order unavailable');
            req.order = order;
            res.setHeader('Cache-Control', 'private, no-store');
            next();
        } catch (error) {
            res.clearCookie('sh_access', { path: '/' });
            if (req.path.startsWith('/api/')) res.status(401).json({ error: 'Your session has expired. Open the recovery link in your email.' });
            else res.redirect(`${siteBase}/payment?error=access`);
        }
    }
    function resultData(order) {
        return {
            ok: true, order_id: order.id, status: order.status, delivery_status: order.delivery_status,
            result: order.result, generation_source: order.generation_source,
            booking: order.booking, context: order.context, email: order.email,
            error_code: order.error_code, generation_attempts: order.generation_attempts, expires_at: order.expires_at,
            purchase: order.amount_cents > 0 ? { transaction_id: order.id, value: order.amount_cents / 100, currency: 'USD' } : null
        };
    }
    const checkout = handle(async (req, res) => res.json(await orders.checkout(req.body)));
    app.post('/api/checkout', rateLimit, checkout);
    app.post('/api/stripe/test', rateLimit, checkout);
    app.post('/api/validate-coupon', rateLimit, handle(async (req, res) => {
        try {
            const price = couponPrice(req.body.code);
            if (!price.code) return res.json({ valid: false, error: 'Enter a coupon code' });
            res.json({ valid: true, code: price.code, type: 'fixed', value: PRICE_CENTS - price.amount, discount_cents: PRICE_CENTS - price.amount, final_cents: price.amount, base_cents: PRICE_CENTS });
        } catch { res.json({ valid: false, error: 'This coupon is not available' }); }
    }));
    app.post('/api/grant-free-access', (req, res) => res.status(410).json({ error: 'Public free access has been retired.' }));
    app.get('/free-access', (req, res) => res.redirect(`${siteBase}/payment?error=coupon`));
    app.post('/admin/orders/free', basicAuth, rateLimit, handle(async (req, res) => {
        const order = await orders.createOrder(req.body, true);
        res.status(202).json({ ok: true, order_id: order.id });
    }));

    app.get('/post-checkout', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            const order = await orders.verifySession(req.query.session_id);
            if (!['paid', 'free'].includes(order.payment_status) || new Date(order.expires_at) <= new Date()) throw new Error('Order unavailable');
            setAccess(res, order);
            res.redirect('/results');
        } catch { res.redirect(`${siteBase}/payment?error=payment-verification`); }
    });
    app.get('/recover', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        try {
            const decoded = verify(req.query.token, 'recover');
            const order = await orders.getOrder(decoded.oid);
            if (!order || !['paid', 'free'].includes(order.payment_status) || new Date(order.expires_at) <= new Date()) throw new Error('Order unavailable');
            setAccess(res, order);
            res.redirect('/results');
        } catch { res.status(401).type('text').send('This recovery link is invalid or expired. Contact support@stayhustler.com for help.'); }
    });
    app.get('/results', access, (req, res) => {
        const html = fs.readFileSync(path.join(__dirname, 'results-shell.html'), 'utf8');
        res.type('html').send(html.replace(/<script\b/g, `<script nonce="${nonceForResponse(res)}"`));
    });
    app.get('/results.html', (req, res) => res.redirect('/results'));
    app.get('/api/results', access, handle(async (req, res) => res.json(resultData(req.order))));
    app.post('/api/generate-request', access, rateLimit, handle(async (req, res) => {
        if (!req.order.result) return res.status(202).json({ status: req.order.status, error: 'Your saved request is being prepared.' });
        res.setHeader('X-Generation-Source', req.order.generation_source);
        res.json(req.order.result);
    }));
    const resend = handle(async (req, res) => {
        if (req.body.email !== undefined && (typeof req.body.email !== 'string' || req.body.email.trim().toLowerCase() !== req.order.email)) throw Object.assign(new Error('Use the verified order email'), { status: 403 });
        if (req.body.delivery_id && req.body.delivery_id !== req.order.id) throw Object.assign(new Error('Delivery not found'), { status: 404 });
        if (!req.order.result) throw Object.assign(new Error('Your request is not ready yet'), { status: 409 });
        const order = await orders.fulfil(req.order.id, true);
        res.status(order.delivery_status === 'accepted' ? 200 : 503).json({ ok: order.delivery_status === 'accepted', delivery_id: order.id, delivery_status: order.delivery_status });
    });
    app.post('/api/deliver-request', access, resendRateLimit, resend);
    app.post('/api/resend-delivery', access, resendRateLimit, resend);
    app.post('/api/orders/feedback', access, rateLimit, handle(async (req, res) => {
        const { outcome, note } = req.body;
        if (!['received', 'not_received', 'not_asked'].includes(outcome) || (note !== undefined && (typeof note !== 'string' || note.length > 1000))) throw Object.assign(new Error('Invalid feedback'), { status: 400 });
        await app.locals.pool.query('UPDATE orders SET feedback=$2 WHERE id=$1', [req.order.id, { outcome, note: note || '', submitted_at: new Date().toISOString() }]);
        res.json({ ok: true });
    }));
    app.get('/api/desk-ask-copy', access, handle(async (req, res) => {
        if (!req.order.result) return res.status(202).json({ status: req.order.status });
        res.json({ title: 'If you ask at the desk', sections: [
            { heading: 'When to ask', bullets: ['Choose a quiet moment when staff can listen.', 'Availability and property policy determine the answer.'] },
            { heading: 'How to reference the email', bullets: ['Mention an earlier email only if you sent one.', 'Accept the answer without putting staff under pressure.'] },
            { heading: 'What to say', bullets: ['Use the request below in your own words.', 'Thank the staff regardless of the outcome.'] }
        ], script: { intro: 'You can say:', line1: req.order.result.fallback_script, line2: '' }, tone_reminders: ['Be polite', 'Be specific', 'Respect the hotel’s decision'] });
    }));
}

module.exports = { registerOrderRoutes };
