const crypto = require('node:crypto');

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function csvCell(value) {
    let text = String(value ?? '');
    if (/^[\s]*[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
}

function equalSecret(actual, expected) {
    if (typeof actual !== 'string' || typeof expected !== 'string' || !expected) return false;
    const a = Buffer.from(actual), b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Shared across replicas, survives restarts, and uses Express's configured proxy boundary.
function limiter(pool, scope, limit, windowSeconds) {
    return async (req, res, next) => {
        try {
            const key = crypto.createHash('sha256').update(`${scope}:${req.ip}`).digest('hex');
            const { rows } = await pool.query(`INSERT INTO request_limits (key,hits,expires_at) VALUES($1,1,now()+$2*INTERVAL '1 second')
                ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN request_limits.expires_at<=now() THEN 1 ELSE request_limits.hits+1 END,
                expires_at=CASE WHEN request_limits.expires_at<=now() THEN now()+$2*INTERVAL '1 second' ELSE request_limits.expires_at END RETURNING hits`, [key, windowSeconds]);
            if (rows[0].hits > limit) return res.set('Retry-After', String(windowSeconds)).status(429).json({ error: 'Too many requests. Please try again later.' });
            next();
        } catch { res.status(503).json({ error: 'Service temporarily unavailable' }); }
    };
}

function configErrors(env) {
    const errors = [];
    for (const key of ['DATABASE_URL','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','GEMINI_API_KEY','SENDGRID_API_KEY','SENDGRID_FROM_EMAIL','ACCESS_TOKEN_SECRET','UNSUBSCRIBE_SECRET','ADMIN_USER','ADMIN_PASS']) {
        if (!env[key] || /^(your_|change-me|replace-me)/i.test(env[key])) errors.push(`${key} must be configured`);
    }
    for (const key of ['ACCESS_TOKEN_SECRET','UNSUBSCRIBE_SECRET']) if ((env[key] || '').length < 32) errors.push(`${key} must contain at least 32 characters`);
    if ((env.ADMIN_PASS || '').length < 16) errors.push('ADMIN_PASS must contain at least 16 characters');
    if (env.CRON_SECRET && env.CRON_SECRET.length < 32) errors.push('CRON_SECRET must contain at least 32 characters');
    if (env.DATABASE_SSL && !['disable','verify-full'].includes(env.DATABASE_SSL)) errors.push('DATABASE_SSL must be disable or verify-full');
    for (const key of ['API_BASE_URL','PUBLIC_BASE_URL']) {
        try {
            const url = new URL(env[key] || (key === 'API_BASE_URL' ? 'https://app.stayhustler.com' : 'https://stayhustler.com'));
            if (url.origin !== url.href.replace(/\/$/, '') || (env.NODE_ENV === 'production' && url.protocol !== 'https:')) errors.push(`${key} must be an origin with HTTPS in production`);
        } catch { errors.push(`${key} must be a valid origin`); }
    }
    if (env.ADMIN_PATH && !/^\/[a-zA-Z0-9_-]+$/.test(env.ADMIN_PATH)) errors.push('ADMIN_PATH must be a single path segment');
    return errors;
}

function databaseOptions(env) {
    return { connectionString: env.DATABASE_URL, ssl: env.DATABASE_SSL === 'disable' || (env.NODE_ENV !== 'production' && !env.DATABASE_SSL) ? false : { rejectUnauthorized: true }, connectionTimeoutMillis: 5000, statement_timeout: 10000 };
}

module.exports = { escapeHtml, csvCell, equalSecret, limiter, configErrors, databaseOptions };
