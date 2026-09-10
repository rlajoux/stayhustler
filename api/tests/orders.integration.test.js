const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const Stripe = require('stripe');
const { createApp } = require('../server');

const databaseUrl = process.env.TEST_DATABASE_URL;
test('paid order lifecycle, security, refunds and retention against PostgreSQL', { skip: !databaseUrl }, async t => {
    const schema = 'audit_' + crypto.randomBytes(8).toString('hex');
    const bootstrap = new Pool({ connectionString: databaseUrl });
    await bootstrap.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 12 });
    const sessions = new Map(), refunds = new Map(), messages = [];
    let generated = 0, failGeneration = false, failMail = false;
    const stripeSdk = new Stripe('sk_test_fixture');
    const stripe = {
        webhooks: stripeSdk.webhooks,
        checkout: { sessions: {
            create: async (body, options) => {
                const existing = [...sessions.values()].find(session => session.key === options.idempotencyKey);
                if (existing) return existing;
                const id = 'cs_test_' + crypto.randomBytes(8).toString('hex');
                const session = { ...body, id, key: options.idempotencyKey, currency: 'usd', amount_total: body.line_items[0].price_data.unit_amount, livemode: false, payment_status: 'unpaid', payment_intent: 'pi_' + id, url: `https://checkout.stripe.com/c/pay/${id}` };
                sessions.set(id, session); return session;
            },
            retrieve: async id => { if (!sessions.has(id)) throw new Error('Unknown session'); return sessions.get(id); }
        } },
        paymentIntents: { retrieve: async id => { const session = [...sessions.values()].find(value => value.payment_intent === id); return { metadata: session?.metadata || {} }; } },
        refunds: { retrieve: async id => refunds.get(id), list: async function* () { yield* refunds.values(); } }
    };
    const output = { email_subject: 'Late checkout on 15 October', email_body: 'Hello, Reservation: [Confirmation Number]\nCould I request late checkout? Thank you, [Your Name]', timing_guidance: ['Ask ahead.', 'Confirm availability.', 'Respect the decision.'], fallback_script: 'Could I request late checkout?' };
    const env = { NODE_ENV: 'test', DATABASE_URL: databaseUrl, DATABASE_SSL: 'disable', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', GEMINI_API_KEY: 'test', SENDGRID_API_KEY: 'test', SENDGRID_FROM_EMAIL: 'support@example.test', ACCESS_TOKEN_SECRET: 'a'.repeat(40), UNSUBSCRIBE_SECRET: 'b'.repeat(40), ADMIN_USER: 'test-admin', ADMIN_PASS: 'a:secure:password:123', API_BASE_URL: 'http://127.0.0.1:3000', PUBLIC_BASE_URL: 'http://127.0.0.1:8080' };
    const runtime = await createApp({ env, pool, stripe, generate: async (booking, context) => {
        generated++; assert.equal(context.requestType, 'late_checkout'); assert.equal(context.flexibility_detail, '4pm');
        assert.equal(context.loyaltyProgramme, 'gha'); assert.equal(context.loyaltyTier, 'platinum');
        assert.equal(context.loyaltyHotelConfirmed, true); assert.equal(context.loyalty, 'GHA DISCOVERY Platinum');
        if (failGeneration) throw new Error('provider down');
        await new Promise(resolve => setTimeout(resolve, 25));
        return { result: output, finalSource: 'first' };
    }, sendMail: async message => { if (failMail) throw new Error('ambiguous network outcome'); messages.push(message); } });
    const server = runtime.app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const body = () => ({ email: 'buyer@example.test', booking: { hotel: 'โรงแรม Audit', city: 'Bangkok', checkin: '2026-10-13', checkout: '2026-10-15', channel: 'direct' }, context: { requestType: 'late_checkout', flexibility_primary: 'timing', flexibility_detail: '4pm', loyaltyProgramme: 'gha', loyaltyTier: 'platinum', loyaltyHotelConfirmed: true }, checkout_key: crypto.randomUUID() });
    const request = (route, payload, extra = {}) => fetch(base + route, { method: payload === undefined ? 'GET' : 'POST', redirect: 'manual', headers: { ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra.headers }, body: payload === undefined ? undefined : JSON.stringify(payload), ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'headers')) });
    const admin = { Authorization: 'Basic ' + Buffer.from(`${env.ADMIN_USER}:${env.ADMIN_PASS}`).toString('base64') };
    const event = session => ({ id: 'evt_' + crypto.randomUUID(), type: 'checkout.session.completed', data: { object: { id: session.id } } });
    const postEvent = async value => {
        const payload = JSON.stringify(value);
        const signature = stripeSdk.webhooks.generateTestHeaderString({ payload, secret: env.STRIPE_WEBHOOK_SECRET });
        return fetch(base + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature }, body: payload });
    };
    let checkout, paidSession, cookie;
    try {
        await t.test('persists input before checkout; concurrent checkout retries return one session', async () => {
            const input = body();
            const responses = await Promise.all([request('/api/checkout', input), request('/api/checkout', input)]);
            const data = await Promise.all(responses.map(response => response.json()));
            assert.equal(data[0].order_id, data[1].order_id); assert.equal(sessions.size, 1);
            checkout = data[0]; paidSession = [...sessions.values()][0];
            const order = await runtime.orders.getOrder(checkout.order_id);
            assert.equal(order.context.requestType, 'late_checkout'); assert.equal(order.booking.hotel, input.booking.hotel);
            assert.equal((await request('/api/checkout', { ...input, email: 'other@example.test' })).status, 409);
        });
        await t.test('expired checkout asks for a fresh key; paid checkout recovers rather than charging twice', async () => {
            const input = body();
            const first = await (await request('/api/checkout', input)).json();
            const session = [...sessions.values()].find(value => value.metadata.order_id === first.order_id);
            session.status = 'expired';
            const expired = await request('/api/checkout', input);
            assert.equal(expired.status, 409); assert.equal((await expired.json()).code, 'checkout_expired');
            session.status = 'complete'; session.payment_status = 'paid';
            const recovered = await (await request('/api/checkout', input)).json();
            assert(recovered.recovery_url.includes('/post-checkout?session_id='));
            // Keep this independent checkout outside the later paid-cohort assertions.
            await pool.query("UPDATE orders SET paid_at=now()-INTERVAL '2 days' WHERE id=$1", [first.order_id]);
        });
        await t.test('unsigned and unpaid callbacks cannot unlock an order', async () => {
            assert.equal((await request('/api/stripe/webhook', event(paidSession))).status, 400);
            assert.equal((await postEvent(event(paidSession))).status, 200);
            assert.equal((await runtime.orders.getOrder(checkout.order_id)).payment_status, 'pending');
            assert.equal((await request('/api/results')).status, 401);
            assert.equal((await request('/api/generate-request', body())).status, 401);
            assert.equal((await request('/api/deliver-request', body())).status, 401);
            assert.equal((await request('/api/grant-free-access', body())).status, 410);
            assert.equal((await request('/api/checkout', { ...body(), coupon_code: 'ADMINFREE100' })).status, 400);
        });
        await t.test('duplicate paid events and concurrent workers fulfil once, even without the browser return', async () => {
            paidSession.payment_status = 'paid';
            const paymentEvent = event(paidSession);
            assert.equal((await postEvent(paymentEvent)).status, 200);
            assert.equal((await postEvent(paymentEvent)).status, 200);
            await Promise.all([runtime.orders.fulfil(checkout.order_id), runtime.orders.fulfil(checkout.order_id)]);
            assert.equal(generated, 1); assert.equal(messages.length, 2); // receipt + saved result
            assert(messages[0].text.includes('/recover?token='));
            assert(messages[1].text.includes(output.email_body));
            assert.equal((await runtime.orders.getOrder(checkout.order_id)).status, 'ready');
        });
        await t.test('Stripe return and recovery link issue an owned HttpOnly session without localStorage', async () => {
            const returned = await request('/post-checkout?session_id=' + paidSession.id);
            assert.equal(returned.headers.get('location'), '/results');
            assert(returned.headers.get('set-cookie').includes('HttpOnly'));
            cookie = returned.headers.get('set-cookie').split(';')[0];
            const response = await request('/api/results', undefined, { headers: { Cookie: cookie } });
            const data = await response.json(); assert.deepEqual(data.result, output); assert.equal(data.purchase.transaction_id, checkout.order_id);
            const order = await runtime.orders.getOrder(checkout.order_id);
            const link = new URL(runtime.orders.recoveryLink(order));
            const recovered = await request(link.pathname + link.search);
            assert.equal(recovered.headers.get('location'), '/results');
            await request('/post-checkout?session_id=' + paidSession.id); await runtime.orders.fulfil(order.id);
            assert.equal(generated, 1); assert.equal(messages.length, 2);
        });
        await t.test('resend cannot change recipient or select another delivery; owned resend reuses saved output', async () => {
            assert.equal((await request('/api/resend-delivery', { email: 'attacker@example.test' }, { headers: { Cookie: cookie } })).status, 403);
            assert.equal((await request('/api/resend-delivery', { delivery_id: crypto.randomUUID() }, { headers: { Cookie: cookie } })).status, 404);
            assert.equal((await request('/api/resend-delivery', { delivery_id: checkout.order_id }, { headers: { Cookie: cookie } })).status, 429);
            await pool.query("UPDATE orders SET delivery_started_at=now()-INTERVAL '2 minutes' WHERE id=$1", [checkout.order_id]);
            const response = await request('/api/resend-delivery', { delivery_id: checkout.order_id }, { headers: { Cookie: cookie } });
            assert.equal(response.status, 200); assert.equal((await response.json()).delivery_id, checkout.order_id);
            assert.equal(generated, 1); assert.equal(messages.at(-1).to, 'buyer@example.test');
        });
        await t.test('feedback is persisted only for the owned paid order', async () => {
            assert.equal((await request('/api/orders/feedback', { outcome: 'received', note: 'Helpful' }, { headers: { Cookie: cookie } })).status, 200);
            assert.equal((await runtime.orders.getOrder(checkout.order_id)).feedback.note, 'Helpful');
        });
        await t.test('free admin grants are authenticated and do not become paid purchases', async () => {
            assert.equal((await request('/admin/orders/free', body())).status, 401);
            const response = await request('/admin/orders/free', body(), { headers: admin }); assert.equal(response.status, 202);
            const order = await runtime.orders.getOrder((await response.json()).order_id);
            const link = new URL(runtime.orders.recoveryLink(order));
            const returned = await request(link.pathname + link.search);
            const freeCookie = returned.headers.get('set-cookie').split(';')[0];
            const data = await (await request('/api/results', undefined, { headers: { Cookie: freeCookie } })).json();
            assert.equal(data.purchase, null);
            const stats = await runtime.orders.statistics(); assert.equal(stats.paid_orders, 1); assert.equal(stats.free_orders, 1);
        });
        await t.test('admin filters work, malicious stored text is escaped and CSV formulas are neutralised', async () => {
            await pool.query("INSERT INTO newsletter_subscribers(email,source) VALUES($1,$2)", ['=1+1@example.test', '<img src=x onerror=alert(1)>']);
            const response = await request('/admin/subscribers?status=subscribed', undefined, { headers: admin });
            assert.equal(response.status, 200); const html = await response.text(); assert(!html.includes('<img src=x')); assert(html.includes('&lt;img'));
            assert(response.headers.get('content-security-policy').includes("script-src 'nonce-"));
            const csv = await (await request('/admin/api/subscribers.csv', undefined, { headers: admin })).text(); assert(csv.includes("\"'=1+1@example.test\""));
            assert.equal((await request('/admin/subscribers?status=bogus', undefined, { headers: admin })).status, 400);
        });
        await t.test('model failure preserves order and recovery; later retry generates once successfully', async () => {
            const data = await (await request('/api/checkout', body())).json();
            const session = [...sessions.values()].find(value => value.metadata.order_id === data.order_id); session.payment_status = 'paid';
            await postEvent(event(session)); failGeneration = true;
            await runtime.orders.fulfil(data.order_id);
            const failed = await runtime.orders.getOrder(data.order_id); assert.equal(failed.status, 'failed'); assert.equal(failed.result, null); assert.equal(failed.receipt_status, 'accepted');
            failGeneration = false;
            await pool.query('UPDATE orders SET next_attempt_at=now() WHERE id=$1', [data.order_id]);
            await runtime.orders.fulfil(data.order_id); assert.equal((await runtime.orders.getOrder(data.order_id)).status, 'ready');
        });
        await t.test('a process stopped during its final generation attempt becomes a visible failure', async () => {
            const order = await runtime.orders.createOrder(body(), true);
            await pool.query("UPDATE orders SET generation_attempts=3,status='processing',receipt_status='accepted' WHERE id=$1", [order.id]);
            const before = generated;
            await runtime.orders.fulfil(order.id);
            assert.equal((await runtime.orders.getOrder(order.id)).status, 'failed');
            assert.equal(generated, before);
        });
        await t.test('email provider ambiguity preserves content and is not blindly retried', async () => {
            const free = await runtime.orders.createOrder(body(), true); failMail = true;
            await runtime.orders.fulfil(free.id); failMail = false;
            const failed = await runtime.orders.getOrder(free.id); assert(failed.result); assert.equal(failed.delivery_status, 'failed');
            const before = messages.length; await runtime.orders.processPending(); assert.equal((await runtime.orders.getOrder(free.id)).delivery_status, 'failed');
            assert(!messages.slice(before).some(message => message.customArgs?.order_id === free.id));
        });
        await t.test('partial, failed and full refunds use current provider status and revoke full-refund access', async () => {
            const refund = { id: 're_test', payment_intent: paidSession.payment_intent, amount: 200, status: 'pending' }; refunds.set(refund.id, refund);
            const makeEvent = type => ({ id: 'evt_' + crypto.randomUUID(), type, data: { object: { id: refund.id } } });
            await postEvent(makeEvent('refund.created')); assert.equal((await runtime.orders.getOrder(checkout.order_id)).refund_cents, 0);
            refund.status = 'succeeded'; await postEvent(makeEvent('refund.updated')); assert.equal((await runtime.orders.getOrder(checkout.order_id)).payment_status, 'paid');
            refund.amount = 700; await postEvent(makeEvent('refund.updated')); assert.equal((await request('/api/results', undefined, { headers: { Cookie: cookie } })).status, 401);
            // Simulate an older provider response finishing after a newer successful one.
            refund.status = 'pending'; await postEvent(makeEvent('refund.updated'));
            assert.equal((await runtime.orders.getOrder(checkout.order_id)).refund_cents, 700);
            await postEvent(event(paidSession)); assert.equal((await runtime.orders.getOrder(checkout.order_id)).payment_status, 'refunded');
        });
        await t.test('a refund arriving before the payment event reconciles the matching order', async () => {
            const data = await (await request('/api/checkout', body())).json();
            const session = [...sessions.values()].find(value => value.metadata.order_id === data.order_id); session.payment_status = 'paid';
            const refund = { id: 're_early', payment_intent: session.payment_intent, amount: 700, status: 'succeeded' }; refunds.set(refund.id, refund);
            assert.equal((await postEvent({ id: 'evt_early', type: 'refund.created', data: { object: { id: refund.id } } })).status, 200);
            assert.equal((await runtime.orders.getOrder(data.order_id)).payment_status, 'refunded');
        });
        await t.test('liveness/readiness and scheduled endpoints fail closed appropriately', async () => {
            assert.equal((await request('/health')).status, 200); assert.equal((await request('/ready')).status, 200);
            assert.equal((await request('/api/cron/hourly-report')).status, 503);
            assert.equal((await request('/api/checkout', body(), { headers: { Origin: 'https://attacker.example' } })).status, 403);
            await pool.query(`ALTER TABLE orders RENAME TO unavailable_orders`);
            assert.equal((await request('/ready')).status, 503); assert.equal((await request('/health')).status, 200);
            await pool.query(`ALTER TABLE unavailable_orders RENAME TO orders`);
        });
        await t.test('arbitrary left-hand forwarding addresses do not evade the shared limit', async () => {
            for (let i = 0; i < 6; i++) {
                const response = await request('/api/subscribe', { email: 'rate@example.test' }, { headers: { 'X-Forwarded-For': `198.51.100.${i}, 203.0.113.7` } });
                assert.equal(response.status, i < 5 ? 200 : 429);
            }
        });
        await t.test('retention removes personal order data and legacy payloads but preserves payment totals', async () => {
            await pool.query("UPDATE orders SET expires_at=now()-INTERVAL '1 day' WHERE id=$1", [checkout.order_id]);
            await pool.query("INSERT INTO request_deliveries(email,booking,context,generated,created_at) VALUES('old@example.test','{}','{}','{}',now()-INTERVAL '31 days')");
            await runtime.orders.expireData();
            const expired = await runtime.orders.getOrder(checkout.order_id); assert.equal(expired.email, null); assert.equal(expired.booking, null); assert.equal(expired.result, null); assert.equal(expired.refund_cents, 700);
            assert.equal((await pool.query('SELECT email FROM request_deliveries')).rows[0].email, '[removed]');
            const link = new URL(runtime.orders.recoveryLink(expired)); assert.equal((await request(link.pathname + link.search)).status, 401);
        });
    } finally {
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
        await pool.end(); await bootstrap.query(`DROP SCHEMA ${schema} CASCADE`); await bootstrap.end();
    }
});
