const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { sanitizeInput, cleanEmail } = require('./validation');

const PRICE_CENTS = 700;
const RETENTION_DAYS = 30;
const FULFILMENT_CONCURRENCY = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function couponPrice(code) {
    if (!code) return { code: null, amount: PRICE_CENTS };
    if (typeof code !== 'string') throw Object.assign(new Error('Invalid coupon'), { status: 400 });
    const normalised = code.trim().toUpperCase();
    const prices = { UPGRADE10: 630, WELCOME5: 200 };
    if (!Object.hasOwn(prices, normalised)) throw Object.assign(new Error('This coupon is not available'), { status: 400 });
    return { code: normalised, amount: prices[normalised] };
}

async function initialiseOrders(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS orders (
            id UUID PRIMARY KEY, checkout_key UUID UNIQUE NOT NULL, request_digest TEXT NOT NULL,
            email TEXT, booking JSONB, context JSONB, amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
            coupon TEXT, stripe_session_id TEXT UNIQUE, payment_intent_id TEXT UNIQUE,
            payment_status TEXT NOT NULL DEFAULT 'pending', status TEXT NOT NULL DEFAULT 'pending',
            result JSONB, generation_source TEXT, generation_attempts INTEGER NOT NULL DEFAULT 0,
            error_code TEXT, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            receipt_status TEXT NOT NULL DEFAULT 'pending', delivery_status TEXT NOT NULL DEFAULT 'pending', delivery_started_at TIMESTAMPTZ,
            refund_cents INTEGER NOT NULL DEFAULT 0, feedback JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(), paid_at TIMESTAMPTZ, fulfilled_at TIMESTAMPTZ,
            expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '30 days'
        );
        CREATE INDEX IF NOT EXISTS orders_pending_idx ON orders (next_attempt_at)
            WHERE payment_status IN ('paid','free') AND status <> 'expired';
        CREATE TABLE IF NOT EXISTS payment_events (id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
        CREATE TABLE IF NOT EXISTS order_refunds (
            id TEXT PRIMARY KEY, order_id UUID NOT NULL REFERENCES orders(id), amount_cents INTEGER NOT NULL,
            status TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS operational_jobs (name TEXT PRIMARY KEY, last_run TIMESTAMPTZ NOT NULL);
    `);
}

/** Owns order/payment state. External providers are injected for isolated integration tests. */
function createOrderService({ pool, stripe, generate, sendMail, secret, fromEmail, apiBase, siteBase, liveMode = false }) {
    async function getOrder(id, connection = pool) {
        if (!UUID.test(id || '')) return null;
        return (await connection.query('SELECT * FROM orders WHERE id=$1', [id])).rows[0] || null;
    }

    async function createOrder(body, free = false) {
        const data = sanitizeInput(body);
        const email = cleanEmail(body.email);
        const price = free ? { code: 'admin-grant', amount: 0 } : couponPrice(body.coupon_code);
        const checkoutKey = body.checkout_key || crypto.randomUUID();
        if (!UUID.test(checkoutKey)) throw Object.assign(new Error('Invalid checkout key'), { status: 400 });
        const digest = crypto.createHash('sha256').update(JSON.stringify({ ...data, email, price })).digest('hex');
        const inserted = await pool.query(`INSERT INTO orders (id,checkout_key,request_digest,email,booking,context,amount_cents,coupon,payment_status,paid_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $9='free' THEN now() ELSE NULL END)
            ON CONFLICT(checkout_key) DO UPDATE SET checkout_key=EXCLUDED.checkout_key RETURNING *`,
        [crypto.randomUUID(), checkoutKey, digest, email, data.booking, data.context, price.amount, price.code, free ? 'free' : 'pending']);
        const order = inserted.rows[0];
        if (order.request_digest !== digest || new Date(order.expires_at) <= new Date()) throw Object.assign(new Error('The booking changed. Start a new checkout.'), { status: 409 });
        return order;
    }

    async function checkout(body) {
        const order = await createOrder(body);
        if (order.payment_status !== 'pending') throw Object.assign(new Error('This order has already been paid. Use your recovery link.'), { status: 409 });
        if (order.stripe_session_id) {
            const existing = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
            if (existing.payment_status === 'paid') {
                await recordPayment(existing);
                return { ok: true, order_id: order.id, recovery_url: `${apiBase}/post-checkout?session_id=${encodeURIComponent(existing.id)}` };
            }
            if (existing.status === 'expired') throw Object.assign(new Error('This checkout expired. Please try again to open a new checkout.'), { status: 409, code: 'checkout_expired' });
            if (existing.status === 'complete') throw Object.assign(new Error('This payment is still being confirmed. Check your email or contact support before paying again.'), { status: 409 });
            return { ok: true, order_id: order.id, checkout_url: existing.url };
        }
        const session = await stripe.checkout.sessions.create({
            mode: 'payment', payment_intent_data: { metadata: { order_id: order.id } }, customer_email: order.email, client_reference_id: order.id,
            line_items: [{ price_data: { currency: 'usd', unit_amount: order.amount_cents, product_data: { name: 'StayHustler hotel request' } }, quantity: 1 }],
            metadata: { order_id: order.id, request_type: order.context.requestType },
            success_url: `${apiBase}/post-checkout?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${siteBase}/payment?cancelled=1`
        }, { idempotencyKey: `checkout-${order.id}` });
        await pool.query('UPDATE orders SET stripe_session_id=$2 WHERE id=$1 AND (stripe_session_id IS NULL OR stripe_session_id=$2)', [order.id, session.id]);
        return { ok: true, order_id: order.id, checkout_url: session.url };
    }

    async function recordPayment(session, connection = pool) {
        const order = await getOrder(session.metadata?.order_id, connection);
        if (!order || session.id !== order.stripe_session_id || session.client_reference_id !== order.id ||
            session.mode !== 'payment' || session.currency !== 'usd' || session.amount_total !== order.amount_cents || session.livemode !== liveMode) {
            throw Object.assign(new Error('Payment does not match this order'), { status: 400 });
        }
        if (session.payment_status !== 'paid') throw Object.assign(new Error('Payment has not completed'), { status: 409 });
        const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
        if (!paymentIntent) throw new Error('Payment intent missing');
        await connection.query(`UPDATE orders SET payment_status='paid', paid_at=now(), expires_at=now()+INTERVAL '30 days', payment_intent_id=$2
            WHERE id=$1 AND payment_status='pending' AND expires_at>now()`, [order.id, paymentIntent]);
        return getOrder(order.id, connection);
    }

    async function verifySession(sessionId) {
        if (typeof sessionId !== 'string' || !/^cs_(test_|live_)?[a-zA-Z0-9_]+$/.test(sessionId) || sessionId.length > 255) throw Object.assign(new Error('Invalid payment session'), { status: 400 });
        return recordPayment(await stripe.checkout.sessions.retrieve(sessionId));
    }

    async function recordRefund(refund, connection) {
        const paymentIntent = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id;
        let order = (await connection.query('SELECT * FROM orders WHERE payment_intent_id=$1 FOR UPDATE', [paymentIntent])).rows[0];
        if (!order) {
            const intent = await stripe.paymentIntents.retrieve(paymentIntent);
            if (!intent.metadata?.order_id) return; // A transaction outside this order system.
            const pending = await getOrder(intent.metadata.order_id, connection);
            if (!pending?.stripe_session_id) throw new Error('Payment association not ready; retry event');
            await recordPayment(await stripe.checkout.sessions.retrieve(pending.stripe_session_id), connection);
            order = (await connection.query('SELECT * FROM orders WHERE payment_intent_id=$1 FOR UPDATE', [paymentIntent])).rows[0];
            if (!order) throw new Error('Payment association not ready; retry event');
        }
        await connection.query(`INSERT INTO order_refunds (id,order_id,amount_cents,status) VALUES ($1,$2,$3,$4)
            ON CONFLICT(id) DO UPDATE SET status=CASE WHEN order_refunds.status IN ('succeeded','failed','canceled')
                THEN order_refunds.status ELSE EXCLUDED.status END,amount_cents=EXCLUDED.amount_cents,updated_at=now()`, [refund.id, order.id, refund.amount, refund.status]);
        await connection.query(`UPDATE orders SET refund_cents=(SELECT COALESCE(SUM(amount_cents),0) FROM order_refunds WHERE order_id=$1 AND status='succeeded') WHERE id=$1`, [order.id]);
        await connection.query(`UPDATE orders SET payment_status='refunded',status='refunded' WHERE id=$1 AND refund_cents>=amount_cents AND amount_cents>0`, [order.id]);
    }

    async function webhook(event) {
        const connection = await pool.connect();
        try {
            await connection.query('BEGIN');
            const inserted = await connection.query('INSERT INTO payment_events(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id', [event.id]);
            if (!inserted.rowCount) { await connection.query('COMMIT'); return; }
            if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
                const session = await stripe.checkout.sessions.retrieve(event.data.object.id);
                if (session.payment_status === 'paid' && session.metadata?.order_id) await recordPayment(session, connection);
            } else if (['refund.created', 'refund.updated', 'refund.failed'].includes(event.type)) {
                await recordRefund(await stripe.refunds.retrieve(event.data.object.id), connection);
            } else if (event.type === 'charge.refunded') {
                for await (const refund of stripe.refunds.list({ charge: event.data.object.id, limit: 100 })) await recordRefund(refund, connection);
            }
            await connection.query('COMMIT');
        } catch (error) {
            await connection.query('ROLLBACK');
            throw error;
        } finally { connection.release(); }
    }

    function recoveryLink(order) {
        const token = jwt.sign({ oid: order.id, purpose: 'recover' }, secret, { expiresIn: Math.max(1, Math.floor((new Date(order.expires_at) - Date.now()) / 1000)), issuer: 'stayhustler', audience: 'results' });
        return `${apiBase}/recover?token=${encodeURIComponent(token)}`;
    }

    async function fulfil(id, resend = false) {
        const connection = await pool.connect();
        let locked = false;
        try {
            locked = (await connection.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [id])).rows[0].locked;
            if (!locked) return getOrder(id);
            let order = await getOrder(id, connection);
            if (!order || !['paid', 'free'].includes(order.payment_status) || new Date(order.expires_at) <= new Date()) return order;
            if (order.receipt_status === 'pending') {
                await connection.query("UPDATE orders SET receipt_status='sending' WHERE id=$1", [id]);
                try {
                    await sendMail({ to: order.email, from: fromEmail, subject: 'Your StayHustler order is saved',
                        text: `Your order ${order.id} is saved. We will send your request separately when it is ready.\n\nOpen your saved order for up to 30 days after purchase:\n${recoveryLink(order)}\n\nIf preparation fails, contact support@stayhustler.com with this order number.` });
                    await connection.query("UPDATE orders SET receipt_status='accepted' WHERE id=$1", [id]);
                } catch { await connection.query("UPDATE orders SET receipt_status='failed' WHERE id=$1", [id]); }
            }
            if (!order.result) {
                if (order.generation_attempts >= 3) {
                    // A process may have stopped during its final attempt. The advisory lock
                    // establishes that no other worker is still generating this order.
                    await connection.query("UPDATE orders SET status='failed',error_code='generation_unavailable' WHERE id=$1 AND status='processing'", [id]);
                    return getOrder(id, connection);
                }
                if (new Date(order.next_attempt_at) > new Date()) return order;
                await connection.query("UPDATE orders SET status='processing',generation_attempts=generation_attempts+1 WHERE id=$1", [id]);
                try {
                    const { result, finalSource } = await generate(order.booking, order.context);
                    const saved = await connection.query(`UPDATE orders SET result=$2,generation_source=$3,status='ready',fulfilled_at=now(),error_code=NULL
                        WHERE id=$1 AND payment_status IN ('paid','free') AND expires_at>now() RETURNING *`, [id, result, finalSource]);
                    order = saved.rows[0];
                    if (!order) return getOrder(id, connection);
                } catch (error) {
                    await connection.query("UPDATE orders SET status='failed',error_code='generation_unavailable',next_attempt_at=now()+INTERVAL '5 minutes' WHERE id=$1 AND payment_status IN ('paid','free')", [id]);
                    console.error('[Order] Generation unavailable', { order_id: id });
                    return getOrder(id, connection);
                }
            }
            if (order.delivery_status === 'accepted' && !resend) return order;
            // An ambiguous provider outcome is reviewed/resubmitted explicitly, never retried blindly.
            if (order.delivery_status === 'sending' && !resend) return order;
            if (resend && order.delivery_started_at && Date.now() - new Date(order.delivery_started_at) < 60000) throw Object.assign(new Error('Please wait a minute before resending'), { status: 429 });
            const sending = await connection.query(`UPDATE orders SET delivery_status='sending',delivery_started_at=now()
                WHERE id=$1 AND payment_status IN ('paid','free') AND expires_at>now() RETURNING id`, [id]);
            if (!sending.rowCount) return getOrder(id, connection);
            const result = order.result;
            try {
                await sendMail({ to: order.email, from: fromEmail, subject: 'Your StayHustler request is ready',
                    text: `${result.email_subject}\n\n${result.email_body}\n\nWhen to ask:\n${result.timing_guidance.join('\n')}\n\nAt the hotel:\n${result.fallback_script}\n\nYou send this request to the hotel yourself.\n\nRecover your result (available for ${RETENTION_DAYS} days after purchase):\n${recoveryLink(order)}`,
                    customArgs: { order_id: order.id } });
                await connection.query("UPDATE orders SET delivery_status='accepted' WHERE id=$1", [id]);
            } catch (error) {
                await connection.query("UPDATE orders SET delivery_status='failed' WHERE id=$1", [id]);
                console.error('[Order] Email not confirmed', { order_id: id });
            }
            return getOrder(id, connection);
        } finally {
            try { if (locked) await connection.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [id]); }
            finally { connection.release(); }
        }
    }

    async function processPending() {
        const rows = (await pool.query(`SELECT id FROM orders WHERE payment_status IN ('paid','free') AND expires_at>now()
            AND ((result IS NULL AND (generation_attempts<3 OR status='processing') AND next_attempt_at<=now()) OR (result IS NOT NULL AND delivery_status='pending'))
            ORDER BY created_at LIMIT 10`)).rows;
        for (let start = 0; start < rows.length; start += FULFILMENT_CONCURRENCY) {
            await Promise.all(rows.slice(start, start + FULFILMENT_CONCURRENCY).map(row => fulfil(row.id)));
        }
    }

    async function expireData() {
        await pool.query(`UPDATE orders SET email=NULL,booking=NULL,context=NULL,result=NULL,feedback=NULL,request_digest='[expired]',status='expired'
            WHERE expires_at<=now() AND status<>'expired'`);
        await pool.query(`UPDATE request_deliveries SET email='[removed]',booking='{}',context='{}',generated='{}',error=NULL
            WHERE created_at<now()-INTERVAL '30 days' AND email<>'[removed]'`);
        await pool.query("DELETE FROM page_views WHERE created_at<now()-INTERVAL '30 days'");
    }

    async function statistics() {
        return (await pool.query(`SELECT COUNT(*) FILTER(WHERE payment_status IN ('paid','refunded') AND amount_cents>0)::int AS paid_orders,
            COUNT(*) FILTER(WHERE payment_status='free')::int AS free_orders,
            COUNT(*) FILTER(WHERE fulfilled_at IS NOT NULL AND amount_cents>0)::int AS fulfilled_paid_orders,
            COALESCE(SUM(amount_cents) FILTER(WHERE payment_status IN ('paid','refunded')),0)::int AS gross_cents,
            COALESCE(SUM(refund_cents),0)::int AS refund_cents,
            (SELECT COUNT(*)::int FROM orders WHERE status='failed' AND expires_at>now() AND payment_status IN ('paid','free')) AS generation_failures,
            (SELECT COUNT(*)::int FROM orders WHERE expires_at>now() AND payment_status IN ('paid','free')
                AND (delivery_status IN ('failed','sending') OR receipt_status IN ('failed','sending'))) AS email_needs_attention,
            (SELECT COUNT(*)::int FROM orders WHERE expires_at>now() AND payment_status IN ('paid','free') AND result IS NULL AND paid_at<now()-INTERVAL '5 minutes') AS overdue_orders
            FROM orders WHERE paid_at>=now()-INTERVAL '24 hours'`)).rows[0];
    }

    return { checkout, createOrder, getOrder, verifySession, webhook, fulfil, processPending, expireData, statistics, recoveryLink };
}

module.exports = { initialiseOrders, createOrderService, couponPrice, PRICE_CENTS, RETENTION_DAYS };
