const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const crypto = require('crypto');
const Stripe = require('stripe');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Stripe (will be null if STRIPE_SECRET_KEY not set)
const stripe = process.env.STRIPE_SECRET_KEY 
    ? new Stripe(process.env.STRIPE_SECRET_KEY)
    : null;

// ============================================================
// POSTGRES DATABASE
// ============================================================
// Singleton pool using DATABASE_URL from Railway.
// Auto-creates newsletter_subscribers table on startup if missing.
// ============================================================

let pool = null;

// Initialize Postgres pool if DATABASE_URL is set
if (process.env.DATABASE_URL) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    // Create tables on startup if they don't exist
    const initDb = async () => {
        try {
            // Newsletter subscribers table
            await pool.query(`
                CREATE TABLE IF NOT EXISTS newsletter_subscribers (
                    id SERIAL PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE,
                    source TEXT NOT NULL DEFAULT 'unknown',
                    status TEXT NOT NULL DEFAULT 'subscribed',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    unsubscribed_at TIMESTAMPTZ NULL,
                    last_ip TEXT NULL,
                    user_agent TEXT NULL
                )
            `);
            console.log('[DB] newsletter_subscribers table ready');

            // Request deliveries table
            await pool.query(`
                CREATE TABLE IF NOT EXISTS request_deliveries (
                    id SERIAL PRIMARY KEY,
                    email TEXT NOT NULL,
                    booking JSONB NOT NULL,
                    context JSONB NOT NULL,
                    generated JSONB NOT NULL,
                    status TEXT NOT NULL DEFAULT 'sent',
                    error TEXT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
            `);
            console.log('[DB] request_deliveries table ready');

            // Page views table for funnel tracking
            await pool.query(`
                CREATE TABLE IF NOT EXISTS page_views (
                    id SERIAL PRIMARY KEY,
                    page TEXT NOT NULL,
                    session_id TEXT,
                    referrer TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
            `);
            console.log('[DB] page_views table ready');
        } catch (err) {
            console.error('[DB] Error initializing tables:', err.message);
        }
    };
    initDb();
} else {
    console.warn('[DB] DATABASE_URL not set - subscriber features disabled');
}

// ============================================================
// UNSUBSCRIBE TOKEN HELPERS
// ============================================================
// Sign and verify email for one-click unsubscribe links.
// Token = HMAC-SHA256(email, UNSUBSCRIBE_SECRET)
// ============================================================

const UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_SECRET || 'change-me-in-production';

// Generate unsubscribe token for an email
function signEmail(email) {
    const hmac = crypto.createHmac('sha256', UNSUBSCRIBE_SECRET);
    hmac.update(email.toLowerCase().trim());
    return hmac.digest('hex');
}

// Verify unsubscribe token (constant-time comparison)
function verifyEmailToken(email, token) {
    const expected = signEmail(email);
    if (!token || token.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'));
}

// ============================================================
// HTTP BASIC AUTH MIDDLEWARE FOR ADMIN
// ============================================================
// Protects /admin and /admin/api routes with username/password
// Uses ADMIN_USER and ADMIN_PASS from environment variables
// ============================================================

function basicAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    
    // Check if credentials are configured
    if (!process.env.ADMIN_USER || !process.env.ADMIN_PASS) {
        console.error('[Admin] ADMIN_USER or ADMIN_PASS not configured');
        return res.status(503).send('Admin access not configured');
    }
    
    // Check if Authorization header exists
    if (!authHeader || !authHeader.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="StayHustler Admin"');
        return res.status(401).send('Unauthorized');
    }
    
    // Decode and verify credentials
    try {
        const base64Credentials = authHeader.slice(6); // Remove 'Basic '
        const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
        const [username, password] = credentials.split(':');
        
        // Constant-time comparison to prevent timing attacks
        const validUsername = crypto.timingSafeEqual(
            Buffer.from(username),
            Buffer.from(process.env.ADMIN_USER)
        );
        const validPassword = crypto.timingSafeEqual(
            Buffer.from(password),
            Buffer.from(process.env.ADMIN_PASS)
        );
        
        if (validUsername && validPassword) {
            // Set noindex header for all admin pages
            res.setHeader('X-Robots-Tag', 'noindex, nofollow');
            return next();
        }
    } catch (err) {
        // Invalid base64 or other parsing error
    }
    
    // Invalid credentials
    res.setHeader('WWW-Authenticate', 'Basic realm="StayHustler Admin"');
    return res.status(401).send('Unauthorized');
}

// CORS configuration
// If ALLOWED_ORIGIN env var is set, use only that origin
// Otherwise, allow default stayhustler.com origins
const defaultOrigins = [
    'https://stayhustler.com',
    'https://www.stayhustler.com'
];

app.use(cors({
    origin: function(origin, callback) {
        console.log(`[CORS] Request from origin: ${origin || 'no-origin'}`);
        
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) {
            console.log('[CORS] Allowing request with no origin');
            return callback(null, true);
        }
        
        // If ALLOWED_ORIGIN is set, use only that
        if (process.env.ALLOWED_ORIGIN) {
            console.log(`[CORS] Checking against ALLOWED_ORIGIN: ${process.env.ALLOWED_ORIGIN}`);
            if (origin === process.env.ALLOWED_ORIGIN) {
                console.log('[CORS] Origin matches ALLOWED_ORIGIN');
                return callback(null, true);
            }
            console.error(`[CORS] Origin rejected: ${origin}`);
            return callback(new Error('Not allowed by CORS'));
        }
        
        // Otherwise allow all origins for now
        console.log('[CORS] Allowing all origins (no ALLOWED_ORIGIN set)');
        callback(null, true);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    exposedHeaders: ['X-Request-Id', 'X-Generation-Source', 'Retry-After'],
    credentials: true // Enable cookies for access control
}));

app.use(express.json());
app.use(cookieParser());

// ============================================================
// SEO ISOLATION FOR APP SUBDOMAIN
// ============================================================
// All responses from app.stayhustler.com should have noindex to
// prevent search engines from indexing API/app pages.
// Defence in depth alongside robots.txt.
// ============================================================

app.use((req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
});

// robots.txt for app subdomain - block all crawling
app.get('/robots.txt', (req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    res.send(`# robots.txt for app.stayhustler.com
# This subdomain hosts API endpoints only - no content to index.

User-agent: *
Disallow: /
`);
});

// ============================================================
// RESULTS ACCESS CONTROL (JWT-BASED)
// ============================================================
// Uses HttpOnly, Secure, SameSite=None cookies with JWT to verify
// that a user has completed Stripe Checkout before viewing results.
// SameSite=None is required for cross-origin cookie setting.
// ============================================================

const RESULTS_COOKIE_SECRET = process.env.RESULTS_COOKIE_SECRET || 'change-me-in-production';
const RESULTS_COOKIE_NAME = 'sh_access';
const RESULTS_COOKIE_MAX_AGE_MS = 60 * 60 * 1000; // 60 minutes
const isProd = process.env.NODE_ENV === 'production';
const BASE_URL = process.env.PUBLIC_BASE_URL || 'https://stayhustler.com';
// API_BASE_URL is where the API server is hosted (for Stripe redirects)
// In production, this should be set to the custom domain
const API_BASE_URL = process.env.API_BASE_URL || (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : 'https://app.stayhustler.com');

// Middleware: Verify sh_access cookie contains valid JWT
function requireAccess(req, res, next) {
    const token = req.cookies[RESULTS_COOKIE_NAME];

    if (!token) {
        console.log('[Access] No access cookie found, redirecting to pricing');
        return res.redirect('/?error=unauthorized');
    }

    try {
        const decoded = jwt.verify(token, RESULTS_COOKIE_SECRET);
        // Token is valid, attach session info to request
        req.paidSession = decoded;
        next();
    } catch (err) {
        console.log('[Access] Invalid or expired token:', err.message);
        // Clear the invalid cookie
        res.clearCookie(RESULTS_COOKIE_NAME, { path: '/' });
        return res.redirect('/?error=session_expired');
    }
}

// Helper: Create signed JWT for results access
function createAccessToken(stripeSessionId, email = null) {
    const payload = {
        sid: stripeSessionId,
        email: email,
        iat: Math.floor(Date.now() / 1000)
    };

    return jwt.sign(payload, RESULTS_COOKIE_SECRET, {
        expiresIn: '60m' // 60 minutes
    });
}

// Helper: Set the access cookie
function setAccessCookie(res, token) {
    res.cookie(RESULTS_COOKIE_NAME, token, {
        httpOnly: true,
        secure: true, // Always secure for cross-origin cookies
        sameSite: 'none', // Required for cross-origin cookie setting
        maxAge: RESULTS_COOKIE_MAX_AGE_MS,
        path: '/'
    });
}

// ============================================================
// RATE LIMITING
// ============================================================
// In-memory rate limiter to protect Gemini API usage.
// Limit: 10 requests per 10 minutes per IP.
// Only applied to POST /api/generate-request.
// ============================================================

const RATE_LIMIT_MAX = 10;              // Max requests per window
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;  // 10 minutes in ms
const rateLimitStore = new Map();       // IP -> { count, windowStart }

// Get client IP from request (handles proxies)
function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        // x-forwarded-for can be comma-separated; take first IP
        return forwarded.split(',')[0].trim();
    }
    return req.socket?.remoteAddress || 'unknown';
}

// Rate limit middleware
function rateLimit(req, res, next) {
    const ip = getClientIp(req);
    const now = Date.now();
    
    // Get or create entry for this IP
    let entry = rateLimitStore.get(ip);
    
    if (!entry) {
        // First request from this IP
        entry = { count: 0, windowStart: now };
        rateLimitStore.set(ip, entry);
    }
    
    // Check if window has expired; if so, reset
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        entry.count = 0;
        entry.windowStart = now;
    }
    
    // Increment count
    entry.count++;
    
    // Check if over limit
    if (entry.count > RATE_LIMIT_MAX) {
        const timeElapsed = now - entry.windowStart;
        const timeRemaining = RATE_LIMIT_WINDOW_MS - timeElapsed;
        const retryAfterSeconds = Math.ceil(timeRemaining / 1000);
        
        console.log('[RateLimit] rate_limited', { ip, count: entry.count, retry_after: retryAfterSeconds });
        res.setHeader('Retry-After', retryAfterSeconds.toString());
        return res.status(429).json({
            error: 'Rate limit exceeded. Please try again in a few minutes.',
            retry_after: retryAfterSeconds
        });
    }
    
    // Allowed - proceed
    next();
}

// Periodic cleanup of stale entries (every 10 minutes)
// Prevents memory leak from accumulated IPs
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitStore.entries()) {
        if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
            rateLimitStore.delete(ip);
        }
    }
}, RATE_LIMIT_WINDOW_MS);

// Stricter rate limiter for resend endpoint
// Limit: 3 requests per 10 minutes per IP
const RESEND_RATE_LIMIT_MAX = 3;
const resendRateLimitStore = new Map();

function resendRateLimit(req, res, next) {
    const ip = getClientIp(req);
    const now = Date.now();
    
    let entry = resendRateLimitStore.get(ip);
    
    if (!entry) {
        entry = { count: 0, windowStart: now };
        resendRateLimitStore.set(ip, entry);
    }
    
    // Check if window has expired; if so, reset
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        entry.count = 0;
        entry.windowStart = now;
    }
    
    // Increment count
    entry.count++;
    
    // Check if over limit
    if (entry.count > RESEND_RATE_LIMIT_MAX) {
        console.log('[ResendRateLimit] rate_limited', { ip, count: entry.count });
        return res.status(429).json({
            error: 'Rate limit exceeded. Please try again in a few minutes.'
        });
    }
    
    // Allowed - proceed
    next();
}

// Cleanup for resend rate limiter
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of resendRateLimitStore.entries()) {
        if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
            resendRateLimitStore.delete(ip);
        }
    }
}, RATE_LIMIT_WINDOW_MS);

// Validation helper
function validateRequest(body) {
    const errors = [];
    
    if (!body.booking) {
        errors.push('Missing booking object');
    } else {
        if (!body.booking.hotel) errors.push('Missing booking.hotel');
        if (!body.booking.city) errors.push('Missing booking.city');
        if (!body.booking.checkin) errors.push('Missing booking.checkin');
        if (!body.booking.checkout) errors.push('Missing booking.checkout');
    }
    
    if (!body.context) {
        errors.push('Missing context object');
    } else {
        if (!body.context.arrivalDay) errors.push('Missing context.arrivalDay');
        if (!body.context.askPreference) errors.push('Missing context.askPreference');
    }
    
    return errors;
}

// Truncate helper
function truncate(str, maxLen = 200) {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen) : str;
}

// ============================================================
// OUTPUT QUALITY VALIDATION
// ============================================================
// Validates Gemini output against strict quality rules:
// A) email_subject: 6-12 words, includes date token, not starting with "Reservation Inquiry"
// B) email_body: 140-220 words, includes "Reservation: [Confirmation Number]",
//    includes "forecasted to remain available" exactly once, no banned words
// C) timing_guidance: array of exactly 3 strings, each 10-140 chars
// D) fallback_script: single sentence, 8-30 words, no banned words
// ============================================================

const BANNED_WORDS = ['hack', 'trick', 'free', 'guarantee', 'owed', 'must', 'demand', 'ai', 'gemini', 'stayhustler'];
const MONTH_TOKENS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Helper: count words in a string
function wordCount(s) {
    if (!s || typeof s !== 'string') return 0;
    return s.trim().split(/\s+/).filter(w => w.length > 0).length;
}

// Helper: count occurrences of a substring (case-sensitive)
function countOccurrences(haystack, needle) {
    if (!haystack || !needle) return 0;
    let count = 0;
    let pos = 0;
    while ((pos = haystack.indexOf(needle, pos)) !== -1) {
        count++;
        pos += needle.length;
    }
    return count;
}

// Helper: check if string contains any banned words (case-insensitive)
// Returns { hit: boolean, words: string[] }
function containsBannedWords(s) {
    if (!s || typeof s !== 'string') return { hit: false, words: [] };
    const lower = s.toLowerCase();
    const foundWords = BANNED_WORDS.filter(word => {
        // Match whole word (avoid false positives)
        const regex = new RegExp(`\\b${word}\\b`, 'i');
        return regex.test(lower);
    });
    return { hit: foundWords.length > 0, words: foundWords };
}

// Helper: check if text looks like a single sentence
function looksLikeSingleSentence(s) {
    if (!s || typeof s !== 'string') return false;
    const trimmed = s.trim();
    // No newlines allowed
    if (trimmed.includes('\n')) return false;
    // Must end with . or ?
    if (!/[.?]$/.test(trimmed)) return false;
    return true;
}

// Helper: check if subject contains a date token
function hasDateToken(s) {
    if (!s || typeof s !== 'string') return false;
    const lower = s.toLowerCase();
    // Check for month names
    if (MONTH_TOKENS.some(m => lower.includes(m))) return true;
    // Check for numeric date patterns (e.g., "1/15", "15-18", "01/15")
    if (/\d{1,2}[\/\-]\d{1,2}/.test(s)) return true;
    // Check for date ranges with dash/en-dash (e.g., "15–18", "15-18")
    if (/\d{1,2}[\–\-]\d{1,2}/.test(s)) return true;
    return false;
}

// Main validation function
function validateOutput(output) {
    const reasons = [];

    // Basic structure check
    if (!output || typeof output !== 'object') {
        return { ok: false, reasons: ['Output is not an object'] };
    }

    // A) email_subject validation
    if (typeof output.email_subject !== 'string') {
        reasons.push('email_subject must be a string');
    } else {
        const subjectWords = wordCount(output.email_subject);
        if (subjectWords < 6 || subjectWords > 12) {
            reasons.push(`email_subject must be 6-12 words (got ${subjectWords})`);
        }
        if (!hasDateToken(output.email_subject)) {
            reasons.push('email_subject must include a date token (e.g., "Jan 15-18")');
        }
        if (output.email_subject.toLowerCase().trim().startsWith('reservation inquiry')) {
            reasons.push('email_subject must NOT start with "Reservation Inquiry"');
        }
    }

    // B) email_body validation (more lenient for repair)
    if (typeof output.email_body !== 'string') {
        reasons.push('email_body must be a string');
    } else {
        const bodyWords = wordCount(output.email_body);
        if (bodyWords < 80 || bodyWords > 300) {
            reasons.push(`email_body must be 80-300 words (got ${bodyWords})`);
        }
        if (!output.email_body.includes('Reservation: [Confirmation Number]')) {
            reasons.push('email_body must include exactly "Reservation: [Confirmation Number]"');
        }
        const forecastCount = countOccurrences(output.email_body, 'forecasted to remain available');
        if (forecastCount === 0 || forecastCount > 2) {
            reasons.push(`email_body must include "forecasted to remain available" (got ${forecastCount})`);
        }
        const bodyBanned = containsBannedWords(output.email_body);
        if (bodyBanned.hit) {
            reasons.push(`email_body contains banned words: ${bodyBanned.words.join(', ')}`);
        }
    }

    // C) timing_guidance validation
    if (!Array.isArray(output.timing_guidance)) {
        reasons.push('timing_guidance must be an array');
    } else if (output.timing_guidance.length !== 3) {
        reasons.push(`timing_guidance must have exactly 3 items (got ${output.timing_guidance.length})`);
    } else {
        output.timing_guidance.forEach((tip, i) => {
            if (typeof tip !== 'string') {
                reasons.push(`timing_guidance[${i}] must be a string`);
            } else if (tip.length < 10 || tip.length > 140) {
                reasons.push(`timing_guidance[${i}] must be 10-140 chars (got ${tip.length})`);
            }
        });
    }

    // D) fallback_script validation
    if (typeof output.fallback_script !== 'string') {
        reasons.push('fallback_script must be a string');
    } else {
        const scriptWords = wordCount(output.fallback_script);
        if (scriptWords < 8 || scriptWords > 30) {
            reasons.push(`fallback_script must be 8-30 words (got ${scriptWords})`);
        }
        if (!looksLikeSingleSentence(output.fallback_script)) {
            reasons.push('fallback_script must be a single sentence (no newlines, ends with . or ?)');
        }
        const scriptBanned = containsBannedWords(output.fallback_script);
        if (scriptBanned.hit) {
            reasons.push(`fallback_script contains banned words: ${scriptBanned.words.join(', ')}`);
        }
    }

    return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

// Deterministic repair step - attempts to fix common validation failures
// without relaxing safety rules (no banned words, no AI mentions)
function repairOutput(output, validationReasons) {
    const repaired = JSON.parse(JSON.stringify(output)); // deep clone
    let repairsMade = [];
    
    // Repair 0: Remove banned words (do this first!)
    if (validationReasons.some(r => r.includes('contains banned words'))) {
        if (typeof repaired.email_body === 'string') {
            const bannedWordReplacements = {
                'demand': 'consider',
                'demands': 'considerations',
                'demanded': 'requested',
                'must': 'would appreciate',
                'owed': 'appreciated',
                'guarantee': 'hope',
                'guaranteed': 'expected',
                'hack': 'approach',
                'trick': 'strategy',
                'free': 'complimentary'
            };
            
            Object.entries(bannedWordReplacements).forEach(([banned, replacement]) => {
                const regex = new RegExp(`\\b${banned}\\b`, 'gi');
                if (regex.test(repaired.email_body)) {
                    repaired.email_body = repaired.email_body.replace(regex, replacement);
                    repairsMade.push(`Replaced banned word: ${banned}`);
                }
            });
        }
        
        if (typeof repaired.fallback_script === 'string') {
            const bannedWordReplacements = {
                'demand': 'request',
                'must': 'would appreciate',
                'owed': 'appreciated',
                'guarantee': 'hope',
                'hack': 'approach',
                'trick': 'strategy',
                'free': 'complimentary'
            };
            
            Object.entries(bannedWordReplacements).forEach(([banned, replacement]) => {
                const regex = new RegExp(`\\b${banned}\\b`, 'gi');
                if (regex.test(repaired.fallback_script)) {
                    repaired.fallback_script = repaired.fallback_script.replace(regex, replacement);
                    repairsMade.push(`Replaced banned word in script: ${banned}`);
                }
            });
        }
    }
    
    // Repair A: Missing reservation line in email_body
    if (validationReasons.some(r => r.includes('Reservation: [Confirmation Number]'))) {
        if (typeof repaired.email_body === 'string' && !repaired.email_body.includes('Reservation: [Confirmation Number]')) {
            // Insert after the greeting (first line)
            const lines = repaired.email_body.split('\n');
            if (lines.length > 0) {
                lines.splice(1, 0, '\nReservation: [Confirmation Number]\n');
                repaired.email_body = lines.join('\n');
                repairsMade.push('Added reservation line');
            }
        }
    }
    
    // Repair B: Missing "forecasted to remain available" phrase
    if (validationReasons.some(r => r.includes('forecasted to remain available'))) {
        if (typeof repaired.email_body === 'string') {
            const count = countOccurrences(repaired.email_body, 'forecasted to remain available');
            if (count === 0) {
                // Find a sentence to modify - look for upgrade request
                const replacements = [
                    [/If any (premium|upgraded|higher-category|suite) rooms/i, 'If any $1 rooms are forecasted to remain available'],
                    [/(premium|upgraded|higher-category|suite) rooms (are|become) available/i, '$1 rooms are forecasted to remain available'],
                    [/rooms (are|become) available/i, 'rooms are forecasted to remain available'],
                    [/if (something|anything) (opens up|becomes available)/i, 'if anything is forecasted to remain available']
                ];
                
                for (const [pattern, replacement] of replacements) {
                    if (pattern.test(repaired.email_body)) {
                        repaired.email_body = repaired.email_body.replace(pattern, replacement);
                        repairsMade.push('Inserted required phrase');
                        break;
                    }
                }
            } else if (count > 1) {
                // Remove duplicates - keep first occurrence
                let firstFound = false;
                repaired.email_body = repaired.email_body.replace(/forecasted to remain available/g, (match) => {
                    if (!firstFound) {
                        firstFound = true;
                        return match;
                    }
                    return 'expected to be available';
                });
                repairsMade.push('Removed duplicate phrase');
            }
        }
    }
    
    // Repair C: Word count outside range - AGGRESSIVE
    if (typeof repaired.email_body === 'string') {
        const bodyWords = wordCount(repaired.email_body);
        if (bodyWords < 140) {
            // Too short - add contextual padding aggressively
            const paddingSentences = [
                'I appreciate your time and consideration in reviewing this request.',
                'Thank you for your attention to this matter, and I look forward to a wonderful stay at your property.',
                'I understand these decisions depend on availability and truly appreciate any consideration you can provide.',
                'Your property has wonderful reviews and I am excited to experience it firsthand.',
                'Please let me know if there is any additional information I can provide.'
            ];
            // Add sentences until we hit minimum (even if we go over a bit)
            let attempts = 0;
            while (wordCount(repaired.email_body) < 140 && attempts < paddingSentences.length) {
                repaired.email_body += '\n\n' + paddingSentences[attempts];
                attempts++;
            }
            if (attempts > 0) {
                repairsMade.push(`Added ${attempts} padding sentence(s) for word count`);
            }
        } else if (bodyWords > 220) {
            // Too long - trim excess sentences
            const sentences = repaired.email_body.split(/\.\s+/);
            if (sentences.length > 4) {
                // Remove middle sentences (usually least critical)
                while (wordCount(repaired.email_body) > 220 && sentences.length > 4) {
                    sentences.splice(Math.floor(sentences.length / 2), 1);
                }
                repaired.email_body = sentences.join('. ');
                repairsMade.push('Trimmed excess sentences for word count');
            }
        }
    }
    
    // Repair D: Subject line missing date token
    if (validationReasons.some(r => r.includes('must include a date token'))) {
        if (typeof repaired.email_subject === 'string' && !hasDateToken(repaired.email_subject)) {
            // Prepend a generic date token
            repaired.email_subject = 'Upcoming stay — ' + repaired.email_subject;
            repairsMade.push('Added date placeholder to subject');
        }
    }
    
    // Repair E: Subject line word count
    if (typeof repaired.email_subject === 'string') {
        const subjectWords = wordCount(repaired.email_subject);
        if (subjectWords < 6) {
            repaired.email_subject = 'Upcoming reservation — ' + repaired.email_subject;
            repairsMade.push('Extended subject line');
        } else if (subjectWords > 12) {
            const words = repaired.email_subject.split(/\s+/);
            repaired.email_subject = words.slice(0, 12).join(' ');
            repairsMade.push('Trimmed subject line');
        }
    }
    
    // Repair F: Timing guidance array issues
    if (Array.isArray(repaired.timing_guidance)) {
        if (repaired.timing_guidance.length < 3) {
            // Add generic tips to reach 3
            const genericTips = [
                'Email 24-36 hours before check-in for best timing',
                'Ask in person during check-in before handing over ID',
                'Be polite, flexible, and understand availability comes first'
            ];
            while (repaired.timing_guidance.length < 3) {
                repaired.timing_guidance.push(genericTips[repaired.timing_guidance.length]);
            }
            repairsMade.push('Added missing timing tips');
        } else if (repaired.timing_guidance.length > 3) {
            repaired.timing_guidance = repaired.timing_guidance.slice(0, 3);
            repairsMade.push('Trimmed excess timing tips');
        }
    }
    
    // Repair G: Fallback script issues
    if (typeof repaired.fallback_script === 'string') {
        const scriptWords = wordCount(repaired.fallback_script);
        if (scriptWords < 8) {
            repaired.fallback_script = 'If any upgraded rooms are forecasted to remain available this evening, I would be grateful to be considered.';
            repairsMade.push('Replaced short fallback script');
        } else if (scriptWords > 30) {
            // Trim to first sentence or first 30 words
            const words = repaired.fallback_script.split(/\s+/);
            repaired.fallback_script = words.slice(0, 30).join(' ') + '.';
            repairsMade.push('Trimmed long fallback script');
        }
        
        // Ensure it ends with . or ?
        if (!/[.?]$/.test(repaired.fallback_script.trim())) {
            repaired.fallback_script = repaired.fallback_script.trim() + '.';
            repairsMade.push('Added period to fallback script');
        }
    }
    
    return { repaired, repairsMade };
}

// Emergency content builder - creates minimal valid content from booking data
// Used when Gemini completely fails to generate anything usable
function buildEmergencyContent(sanitizedData) {
    const { booking, context } = sanitizedData;
    const hotel = booking.hotel || 'your property';
    const checkin = booking.checkin || 'my upcoming stay';
    const room = booking.room || 'standard room';
    const channel = booking.channel || 'online';
    
    // Format date for subject
    let dateStr = 'Upcoming stay';
    if (checkin) {
        try {
            const date = new Date(checkin);
            const month = date.toLocaleString('en-US', { month: 'short' });
            const day = date.getDate();
            dateStr = `${month} ${day} arrival`;
        } catch (e) {
            // Use generic if date parsing fails
        }
    }
    
    const email_subject = `${dateStr} — pre-arrival request`;
    
    const email_body = `Hello ${hotel} Team,

Reservation: [Confirmation Number]

I'm writing ahead of my ${checkin} arrival. I ${channel === 'direct' ? 'booked directly with you' : 'booked online'} and reserved a ${room}.

If any higher-category rooms or suites are forecasted to remain available around my check-in time, I would be grateful to be considered for an upgrade. I'm flexible on room type and location and completely understand that availability comes first.

I appreciate your property's hospitality and am looking forward to my stay. If an upgrade isn't possible, I'm of course happy to keep my existing reservation as booked.

Thank you for any consideration you can provide.

Warm regards,
[Your Name]`;

    const timing_guidance = [
        'Email this 24-36 hours before check-in for best results',
        'You can also ask politely at check-in before handing over your ID',
        'Be flexible and understanding—availability drives all upgrade decisions'
    ];
    
    const fallback_script = 'If any upgraded rooms are forecasted to remain available around check-in, I would be grateful to be considered.';
    
    return {
        email_subject,
        email_body,
        timing_guidance,
        fallback_script
    };
}

// Build correction prompt for retry
function buildCorrectionPrompt(originalPrompt, reasons) {
    return `You previously returned output that violated these constraints:
${reasons.map(r => `- ${r}`).join('\n')}

Please generate a CORRECTED response that fixes ALL the above issues.

CRITICAL REQUIREMENTS (MUST FOLLOW EXACTLY):
- email_subject: 6-12 words, must include date (e.g., "Jan 15-18"), must NOT start with "Reservation Inquiry"
- email_body: MUST BE 140-220 WORDS (count carefully!), must include "Reservation: [Confirmation Number]" exactly, must include "forecasted to remain available" EXACTLY ONCE, NEVER use these banned words: hack, trick, free, guarantee, owed, must, demand
- timing_guidance: exactly 3 items, each 10-140 characters
- fallback_script: single sentence, 8-30 words, ends with . or ?

WORD COUNT IS CRITICAL: The email_body must have at least 140 words. Add more detail and context if needed.
BANNED WORDS: Never use "demand" - use alternatives like "consider", "reviewing", "attention"

Respond with STRICT JSON only. No markdown, no code blocks, no commentary.
{
  "email_subject": "string",
  "email_body": "string",
  "timing_guidance": ["string", "string", "string"],
  "fallback_script": "string"
}

Original context for reference:
${originalPrompt}

Generate the CORRECTED JSON response:`;
}

// Deterministic fallback payload (must pass all validation rules)
// - email_subject: 6-12 words, includes date token, not starting with "Reservation Inquiry"
// - email_body: 140-220 words, includes "Reservation: [Confirmation Number]", "forecasted to remain available" once
// - timing_guidance: 3 items, each 10-140 chars
// - fallback_script: 8-30 words, single sentence, ends with . or ?
function getFallbackPayload() {
    return {
        email_subject: "Upcoming stay Jan 15–18 — request ahead of arrival",
        email_body: `Hello [Hotel Team],

Reservation: [Confirmation Number]

I'm writing ahead of my upcoming stay to share a quick note with your team. I'm very much looking forward to visiting your property and experiencing everything it has to offer during my time with you.

If any higher-category rooms, including suites, are forecasted to remain available around my check-in time, I would be truly grateful to be considered. I'm flexible on room type and timing, and I completely understand that availability and operational needs always come first.

This trip is a special occasion for me, and any additional touches to make the stay memorable would be wonderful, though certainly not expected. If an upgrade isn't possible, I'm of course happy to keep my existing reservation exactly as booked.

Thank you so much for any consideration you can offer. I truly appreciate your hospitality and look forward to arriving soon. Please don't hesitate to reach out if you need any information from me before my arrival.

Warm regards,
[Your Name]`,
        timing_guidance: [
            "Send 24–36 hours before arrival when staffing is stable.",
            "Be specific and flexible; availability drives decisions.",
            "If no reply, ask calmly at check-in before ID is handed over."
        ],
        fallback_script: "If any upgraded rooms are expected to remain available this evening, I would be grateful to be considered."
    };
}

// Sanitize input
function sanitizeInput(body) {
    return {
        booking: {
            hotel: truncate(body.booking?.hotel),
            city: truncate(body.booking?.city),
            checkin: truncate(body.booking?.checkin, 10),
            checkout: truncate(body.booking?.checkout, 10),
            room: truncate(body.booking?.room || ''),
            channel: truncate(body.booking?.channel || 'Direct with hotel')
        },
        context: {
            lengthOfStay: truncate(body.context?.lengthOfStay || ''),
            arrivalDay: truncate(body.context?.arrivalDay || ''),
            checkinTimePref: truncate(body.context?.checkinTime || body.context?.checkinTimePref || ''),
            loyalty: truncate(body.context?.loyaltyStatus || body.context?.loyalty || 'None'),
            occasion: truncate(body.context?.occasion || 'None'),
            flexibility: truncate(body.context?.flexibility || 'any'),
            preferredRoomType: truncate(body.context?.preferredRoom || body.context?.preferredRoomType || ''),
            askPreference: truncate(body.context?.askPreference || 'both')
        }
    };
}

// ============================================================
// REQUEST TYPE CONFIGURATIONS
// ============================================================
// Each request type has specific prompt rules and templates
// ============================================================

const REQUEST_TYPE_CONFIG = {
    upgrade: {
        label: 'Room upgrade',
        emailGoal: 'Request a higher room category',
        subjectPrefix: 'Upcoming stay',
        askDescription: 'a higher-category room or suite',
        fallbackAsk: 'better view or quieter location',
        whyItWorks: [
            'Uses hotel-native language that staff recognize',
            'Shows flexibility which makes approval easier',
            'Acknowledges availability constraints upfront'
        ]
    },
    late_checkout: {
        label: 'Late checkout',
        emailGoal: 'Request extended checkout time on departure day',
        subjectPrefix: 'Late checkout inquiry',
        askDescription: 'late checkout (around 1-2pm if possible)',
        fallbackAsk: 'luggage storage after checkout',
        whyItWorks: [
            'Late checkout depends on housekeeping schedule',
            'Asking early gives the hotel time to plan',
            'Offering flexibility on exact time increases approval odds'
        ]
    },
    breakfast_lounge: {
        label: 'Breakfast / lounge access',
        emailGoal: 'Request complimentary breakfast or lounge access',
        subjectPrefix: 'Question about breakfast/lounge',
        askDescription: 'access to the breakfast service or executive lounge during my stay',
        fallbackAsk: 'any available dining credits or promotions',
        whyItWorks: [
            'Lounge access is easier to grant during low-occupancy periods',
            'Special occasions make this request more compelling',
            'Being flexible about timing (off-peak hours) helps'
        ]
    },
    better_view: {
        label: 'Better view',
        emailGoal: 'Request a room with a better view or location (same category)',
        subjectPrefix: 'Room placement preference',
        askDescription: 'a room with a nicer view or better location (higher floor, corner room, or quieter area)',
        fallbackAsk: 'away from elevators or in a quieter section',
        whyItWorks: [
            'View requests are easier to grant than category upgrades',
            'Hotels often have flexibility in room assignment',
            'No revenue impact makes approval more likely'
        ]
    },
    credit_spa_fb: {
        label: 'Spa / F&B credit',
        emailGoal: 'Request property credit for spa or dining',
        subjectPrefix: 'Inquiry about property amenities',
        askDescription: 'any available credit toward spa services or dining at the property',
        fallbackAsk: 'any special promotions or packages available',
        whyItWorks: [
            'Property credits drive on-site revenue for the hotel',
            'Special occasions make this request more natural',
            'Shows you value the property\'s amenities'
        ]
    },
    any_upgrade: {
        label: 'Any enhancement',
        emailGoal: 'Request any available enhancement or upgrade',
        subjectPrefix: 'Upcoming stay',
        askDescription: 'any available enhancement — whether a room upgrade, better view, late checkout, or other amenity',
        fallbackAsk: 'any small touch that might enhance my stay',
        whyItWorks: [
            'Maximum flexibility gives the hotel more options',
            'Hotels appreciate guests who are easy to please',
            'Opens the door to whatever is most available'
        ]
    }
};

// Get request type config with fallback to upgrade
function getRequestTypeConfig(requestType) {
    return REQUEST_TYPE_CONFIG[requestType] || REQUEST_TYPE_CONFIG.upgrade;
}

// Build the prompt for Gemini
function buildPrompt(data) {
    const { booking, context } = data;

    // Handle new flexibility fields with backward compatibility
    const flexPrimary = context.flexibility_primary || context.flexibility || 'any';
    const flexDetail = context.flexibility_detail || '';

    // Get request type (default to 'upgrade' for backward compatibility)
    const requestType = context.requestType || 'upgrade';
    const rtConfig = getRequestTypeConfig(requestType);

    return `You are an expert in hotel guest relations. Generate a polite, professional, and SPECIFIC hotel ${rtConfig.label.toLowerCase()} request email.

REQUEST TYPE: ${requestType}
REQUEST GOAL: ${rtConfig.emailGoal}
PRIMARY ASK: ${rtConfig.askDescription}
FALLBACK ASK: ${rtConfig.fallbackAsk}

INPUT DATA:
- Hotel: ${booking.hotel}
- City: ${booking.city}
- Check-in: ${booking.checkin}
- Check-out: ${booking.checkout}
- Room booked: ${booking.room || 'Not specified'}
- Booking channel: ${booking.channel}
- Length of stay: ${context.lengthOfStay || 'Not specified'}
- Arrival day: ${context.arrivalDay}
- Preferred check-in time: ${context.checkinTimePref || 'Not specified'}
- Loyalty status: ${context.loyalty}
- Occasion: ${context.occasion}
- Flexibility priority: ${flexPrimary}
- Flexibility detail: ${flexDetail || 'N/A'}
- How guest prefers to ask: ${context.askPreference}

===== SUBJECT LINE RULES =====
- email_subject MUST be 6–12 words.
- MUST include the stay dates in short format (e.g., "Jan 15–18").
- MUST NOT start with "Reservation Inquiry" or sound overly formal.
- Subject should reflect the REQUEST TYPE:
  - For upgrade: "Upcoming stay Jan 15–18 — flexibility if available"
  - For late_checkout: "Late checkout inquiry for Jan 15–18 stay"
  - For breakfast_lounge: "Question about Jan 15–18 stay amenities"
  - For better_view: "Room preference for Jan 15–18 stay"
  - For credit_spa_fb: "Inquiry ahead of Jan 15–18 stay"

===== EMAIL BODY RULES =====
1. Length: email_body MUST be 160–210 words. Not shorter, not longer.

2. Reservation Line: Near the top of the email (after greeting), include exactly:
   "Reservation: [Confirmation Number]"
   Keep this placeholder exactly as shown.

3. The Ask: CRITICAL - Adapt based on REQUEST TYPE first, then flexibility_priority:

   ===== REQUEST TYPE SPECIFIC RULES =====

   IF REQUEST_TYPE = "upgrade":
   - PRIMARY ASK: Request ${rtConfig.askDescription}
   - FALLBACK: ${rtConfig.fallbackAsk}
   - Use the phrase "forecasted to remain available" exactly ONCE
   - Adapt based on flexibility_priority (see below)

   IF REQUEST_TYPE = "late_checkout":
   - PRIMARY ASK: Request late checkout (mention preferred time like 1pm or 2pm if possible)
   - FALLBACK: Ask about luggage storage after checkout if late checkout isn't possible
   - Do NOT use "forecasted to remain available" - instead use "if scheduling permits"
   - Mention flexibility on exact checkout time
   - Reference the checkout date from the booking

   IF REQUEST_TYPE = "breakfast_lounge":
   - PRIMARY ASK: Politely inquire about access to breakfast or executive lounge
   - FALLBACK: Any dining credits or special offers
   - Do NOT use "forecasted to remain available" - instead use "if any options are available"
   - If there's an occasion, weave it in naturally
   - Do NOT sound entitled to lounge access

   IF REQUEST_TYPE = "better_view":
   - PRIMARY ASK: Request better view/placement (higher floor, corner room, ocean/city view)
   - FALLBACK: Quiet location, away from elevators
   - Do NOT ask for a room category upgrade
   - Use "if room placement flexibility exists" instead of "forecasted"
   - Emphasize you're happy with your room category

   IF REQUEST_TYPE = "credit_spa_fb":
   - PRIMARY ASK: Inquire about any available spa or dining credits
   - FALLBACK: Any special packages or promotions
   - Do NOT use "forecasted to remain available"
   - If there's an occasion, use it as context (celebrating, special trip)
   - Ask graciously, never assume entitlement

   ===== FLEXIBILITY PRIORITY MODIFICATIONS (for upgrade request type only) =====

   IF flexibility_priority = "any" AND REQUEST_TYPE = "upgrade":
   - Ask for "any higher-category room" (optionally mention "including suites if appropriate")
   - State general flexibility on room type

   IF flexibility_priority = "category" AND REQUEST_TYPE = "upgrade":
   - Ask for higher-category room
   - If flexibility_detail is present, incorporate it as a preference (e.g., "particularly a junior suite")
   - Still include flexibility language (e.g., "open to similar categories if needed")

   IF flexibility_priority = "view" AND REQUEST_TYPE = "upgrade":
   - PRIMARY ask must be for "a better located room" - emphasize: higher floor, better view, quieter location
   - Do NOT focus on category upgrade; view/location is the priority

   IF flexibility_priority = "timing" AND REQUEST_TYPE = "upgrade":
   - PRIMARY ask must be late checkout OR early check-in
   - Do NOT push hard for category upgrade

   IF flexibility_priority = "none":
   - Keep request minimal and gracious regardless of request type

4. Specificity: Reference at least TWO of these details from input (if available):
   - Arrival day or check-in date
   - Length of stay
   - Booking channel
   - Loyalty status (if any)
   - Occasion (if any)
   - Flexibility preferences (adapt based on flexibility_priority)

5. Flexibility Signal: Mention flexibility in a way that matches flexibility_priority (room type for any/category, location for view, timing for timing, minimal for none).

6. Operational Courtesy: Include ONE signal showing hotel-operations awareness:
   - E.g., "I understand availability and demand come first"

7. Soft Close: End with acknowledgment that they're happy to keep their existing booking if not possible.

8. Tone: Warm, gracious, never entitled or pressuring. Sound like a seasoned traveler, not someone gaming the system.

===== MITIGATION STRATEGIES (WHEN STRUCTURAL DISADVANTAGES APPLY) =====
When a structural disadvantage applies, SUBTLY reduce friction by acknowledging constraints and increasing flexibility. Add at most 1–2 mitigation sentences. Do NOT fabricate facts or become apologetic.

A) OTA BOOKING MITIGATION:
   If booking.channel contains "ota" or "travel agency":
   - Add explicit flexibility language: "I'm very flexible on room type/timing"
   - Include 'easy guest' signal: "completely understand availability comes first"
   - Avoid any sense of entitlement or demand
   - Natural placement: weave into flexibility or operational courtesy sentences

B) PEAK / HIGH-DEMAND MITIGATION:
   If arrivalDay is "friday" or "saturday" OR city suggests compressed market (e.g., New York, Paris, London):
   - Add ONE sentence acknowledging demand reality
   - Example pattern (adapt naturally): "I know this is a busy arrival period and appreciate any consideration if something opens up"
   - Placement: after the main ask, before the soft close

C) LONG STAY MITIGATION:
   If lengthOfStay suggests 4+ nights (e.g., "5+", "3-4" on upper end):
   - Offer partial flexibility: "Even for part of the stay, I'd be grateful to be considered"
   - Natural placement: same sentence or immediately after the main ask

D) PREMIUM ROOM MITIGATION:
   If booking.room suggests premium category (contains "suite", "executive", "premium", "deluxe"):
   - Pivot PRIMARY ask to placement/view/timing rather than category upgrade
   - Keep category mention secondary: "If a higher category is forecasted to remain available, wonderful, but primarily interested in..."
   - Emphasize: better location, view, floor, quiet placement
   - Do NOT push hard for room category upgrade

E) LAST-MINUTE TIMING MITIGATION:
   If check-in date is very near current date (same day or within 24 hours):
   - Remove urgency and pressure explicitly
   - Example pattern: "If anything becomes available later today or during my stay..."
   - Tone: calm, no rush, understanding

SAFEGUARDS:
- Do NOT combine more than 2 mitigation strategies in one email
- Mitigation language must fit naturally within 140-220 word count (TARGET: 160-180 words)
- Do NOT violate tone rules (no apologies, no over-explaining)
- Do NOT fabricate details (occasions, loyalty, prior stays)
- All existing validation rules still apply

===== BANNED PHRASES =====
Never use: "free", "guarantee", "hack", "trick", "owed", "must", "demand", "entitled", "deserve", "upgrade or perks"

===== ADDITIONAL RULES =====
- Do NOT mention "AI", "Gemini", or "StayHustler"
- Do NOT claim to contact the hotel on behalf of the guest
- Use [Your Name] as the signature placeholder
- If an occasion is mentioned (birthday, anniversary, honeymoon), weave it in naturally
- If loyalty status exists, mention membership subtly (not as leverage)
- If flexibility_priority is not provided or unrecognized, treat it as "any"

===== GOLD STANDARD EXAMPLES (emulate tone and structure, do NOT copy verbatim) =====

EXAMPLE 1 - Standard request (no major disadvantages):
Subject: Upcoming stay Jan 15–17 — quick note ahead of arrival

Hello [Hotel Team],

Reservation: [Confirmation Number]

I'm looking forward to my upcoming stay arriving Thursday, January 15th for two nights. I booked a Deluxe King directly with the hotel and wanted to reach out ahead of arrival.

If any higher-category rooms, including suites, are forecasted to remain available around my check-in time, I'd be grateful to be considered. I'm flexible on room type and timing and completely understand that availability and demand come first.

This trip is to celebrate our anniversary, so any additional touches would be wonderful but certainly not expected. If it's not possible, I'm of course happy to keep my existing reservation as booked.

Thank you for any consideration. I'm excited to experience the property.

Warm regards,
[Your Name]

---

EXAMPLE 2 - OTA booking + peak weekend (mitigation applied):
Subject: Arrival Jan 15–17 — flexible request ahead of stay

Hello [Hotel Team],

Reservation: [Confirmation Number]

I'm very much looking forward to my upcoming Friday arrival for two nights. I booked a Standard King through Booking.com and wanted to reach out with a flexible request.

If any higher-category rooms are forecasted to remain available around check-in, I'd be grateful to be considered. I'm very flexible on room type and timing and completely understand availability comes first, particularly on a weekend arrival.

Even a better location or quieter room would be wonderful. If nothing is possible, I'm of course happy to keep my existing reservation exactly as booked.

Thank you for any consideration you can offer. I appreciate the property's hospitality.

Warm regards,
[Your Name]

---

===== OUTPUT FORMAT =====
Respond with STRICT JSON only. No markdown, no code blocks, no commentary.
{
  "email_subject": "6-12 word subject including dates (e.g., Jan 15–18), reflecting the REQUEST TYPE",
  "email_body": "Full email text (140-220 words, TARGET 160-180). Must include 'Reservation: [Confirmation Number]' near top. Use [Your Name] for signature. ADAPT THE ASK based on REQUEST TYPE. NEVER use banned words: hack, trick, free, guarantee, owed, must, demand.",
  "timing_guidance": ["First timing tip tailored to REQUEST TYPE", "Second timing tip", "Third timing tip"],
  "fallback_script": "One sentence for asking at the front desk in person. ALIGN WITH REQUEST TYPE: upgrade = upgraded rooms, late_checkout = checkout time, breakfast_lounge = breakfast/lounge options, better_view = room placement, credit_spa_fb = spa/dining credits",
  "request_type": "${requestType}"
}

Generate the JSON response:`;
}

// Call Gemini API
async function callGemini(prompt) {
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY not configured');
    }
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            contents: [{
                parts: [{
                    text: prompt
                }]
            }],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 1024,
                responseMimeType: "application/json"
            }
        })
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        console.error('Gemini API error:', response.status, errorText);
        throw new Error(`Gemini API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Extract the generated text
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!generatedText) {
        throw new Error('No content generated');
    }
    
    // Parse the JSON response
    try {
        // Clean up potential markdown code blocks
        let cleanedText = generatedText.trim();
        if (cleanedText.startsWith('```json')) {
            cleanedText = cleanedText.slice(7);
        }
        if (cleanedText.startsWith('```')) {
            cleanedText = cleanedText.slice(3);
        }
        if (cleanedText.endsWith('```')) {
            cleanedText = cleanedText.slice(0, -3);
        }
        
        return JSON.parse(cleanedText.trim());
    } catch (parseError) {
        console.error('Failed to parse Gemini response:', generatedText);
        throw new Error('Invalid JSON response from Gemini');
    }
}

// ============================================================
// GENERATION LOGIC (reusable)
// ============================================================
// Core generation function used by both /api/generate-request and /api/deliver-request
// Returns the generated payload with quality enforcement
// ============================================================

async function generateRequestPayload(booking, context, requestId = null) {
    const sanitizedData = sanitizeInput({ booking, context });
    const prompt = buildPrompt(sanitizedData);
    
    let firstPassValid = false;
    let secondPassAttempted = false;
    let finalSource = 'fallback';
    const rid = requestId || 'unknown';
    
    console.log(`[Generation:${rid}] Starting generation for hotel=${sanitizedData.booking.hotel}`);
    
    try {
        // First pass: Call Gemini
        console.log(`[Generation:${rid}] Calling Gemini (first pass)`);
        const firstResult = await callGemini(prompt);
        
        // Validate first pass
        const firstValidation = validateOutput(firstResult);
        firstPassValid = firstValidation.ok;
        
        if (firstValidation.ok) {
            finalSource = 'first';
            console.log(`[Generation:${rid}] ✓ First pass valid, final_source=first`);
            return { result: firstResult, finalSource };
        }
        
        // First pass failed - attempt retry with correction prompt
        console.log(`[Generation:${rid}] ✗ First pass failed: ${firstValidation.reasons.join('; ')}`);
        secondPassAttempted = true;
        
        console.log(`[Generation:${rid}] Attempting second pass with corrections`);
        const correctionPrompt = buildCorrectionPrompt(prompt, firstValidation.reasons);
        const secondResult = await callGemini(correctionPrompt);
        
        // Validate second pass
        const secondValidation = validateOutput(secondResult);
        
        if (secondValidation.ok) {
            finalSource = 'second';
            console.log(`[Generation:${rid}] ✓ Second pass valid, final_source=second`);
            return { result: secondResult, finalSource };
        }
        
        // Second pass also failed - attempt deterministic repair before fallback
        console.log(`[Generation:${rid}] ✗ Second pass failed: ${secondValidation.reasons.join('; ')}`);
        console.log(`[Generation:${rid}] Attempting aggressive repair step`);
        
        const { repaired, repairsMade } = repairOutput(secondResult, secondValidation.reasons);
        
        if (repairsMade.length > 0) {
            console.log(`[Generation:${rid}] Repairs applied: ${repairsMade.join('; ')}`);
            
            // Validate repaired output
            const repairedValidation = validateOutput(repaired);
            
            if (repairedValidation.ok) {
                finalSource = 'repaired';
                console.log(`[Generation:${rid}] ✓ Repaired output valid, final_source=repaired`);
                return { result: repaired, finalSource };
            } else {
                // FORCE USE REPAIRED CONTENT even if not perfect
                // It's better to show customized content with minor issues than generic fallback
                finalSource = 'repaired-forced';
                console.log(`[Generation:${rid}] ⚠ Using repaired content despite minor issues: ${repairedValidation.reasons.join('; ')}`);
                return { result: repaired, finalSource };
            }
        } else {
            // Try repairing first pass if it exists and has fewer issues
            console.log(`[Generation:${rid}] No repairs from second pass, trying first pass repair`);
            const { repaired: firstRepaired, repairsMade: firstRepairsMade } = repairOutput(firstResult, firstValidation.reasons);
            
            if (firstRepairsMade.length > 0) {
                console.log(`[Generation:${rid}] First pass repairs: ${firstRepairsMade.join('; ')}`);
                finalSource = 'repaired-forced';
                return { result: firstRepaired, finalSource };
            }
            
            // Last resort: use second pass as-is (customized content is better than template)
            console.log(`[Generation:${rid}] ⚠ Using second pass as-is (customized, may have minor issues)`);
            finalSource = 'forced';
            return { result: secondResult, finalSource };
        }
        
    } catch (geminiError) {
        console.error(`[Generation:${rid}] Gemini error: ${geminiError.message}`);
        
        // Even on exception, try to return something if we got partial results
        try {
            console.log(`[Generation:${rid}] Attempting to build emergency content from context`);
            const emergencyContent = buildEmergencyContent(sanitizedData);
            finalSource = 'emergency';
            return { result: emergencyContent, finalSource };
        } catch (emergencyError) {
            console.error(`[Generation:${rid}] Emergency content failed: ${emergencyError.message}`);
            console.log(`[Generation:${rid}] Using fallback as last resort`);
            finalSource = 'fallback';
        }
    }
    
    // Return fallback payload ONLY as absolute last resort
    console.log(`[Generation:${rid}] Returning fallback as absolute last resort, final_source=fallback`);
    return { result: getFallbackPayload(), finalSource };
}

// Handle preflight OPTIONS request for CORS (no rate limiting on OPTIONS)
app.options('/api/generate-request', (req, res) => {
    try {
        console.log('[OPTIONS] /api/generate-request preflight request received');
        // CORS headers are already set by cors middleware
        res.status(204).end();
    } catch (error) {
        console.error('[OPTIONS] Error handling preflight:', error);
        res.status(500).json({ error: 'Preflight error' });
    }
});

// API endpoint (rate limited)
app.post('/api/generate-request', rateLimit, async (req, res) => {
    // Generate correlation ID for tracking
    const requestId = Math.random().toString(36).substring(2, 9);
    
    console.log(`[API:${requestId}] POST /api/generate-request received`);
    
    try {
        // Validate request
        const errors = validateRequest(req.body);
        if (errors.length > 0) {
            console.log(`[API:${requestId}] Validation failed: ${errors.join('; ')}`);
            return res.status(400).json({ 
                error: 'Validation failed', 
                details: errors 
            });
        }
        
        console.log(`[API:${requestId}] Request validated, has_booking=${!!req.body.booking}, has_context=${!!req.body.context}`);
        
        // Generate using reusable function
        const { result, finalSource } = await generateRequestPayload(req.body.booking, req.body.context, requestId);
        
        // Add headers for frontend observability
        res.setHeader('X-Request-Id', requestId);
        res.setHeader('X-Generation-Source', finalSource);
        
        console.log(`[API:${requestId}] Returning response with source=${finalSource}`);
        return res.json(result);
        
    } catch (error) {
        console.error(`[API:${requestId}] Unexpected error in request handling:`, error.message);
        
        // Set headers even on error for observability
        res.setHeader('X-Request-Id', requestId || 'error');
        res.setHeader('X-Generation-Source', 'error');
        
        // Only return 502 for actual server errors (not content quality issues)
        res.status(502).json({
            error: 'Failed to generate request',
            message: 'Unable to generate custom content at this time. Please try again.'
        });
    }
});

// ============================================================
// NEWSLETTER SUBSCRIPTION ENDPOINTS
// ============================================================

// Simple email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/subscribe - Subscribe to newsletter
app.post('/api/subscribe', async (req, res) => {
    try {
        // Check if DB is available
        if (!pool) {
            console.error('[Subscribe] Database not configured');
            return res.status(500).json({ error: 'Subscription failed.' });
        }

        const { email, source } = req.body;

        // Validate email
        if (!email || typeof email !== 'string') {
            return res.status(400).json({ error: 'Email is required.' });
        }

        const cleanEmail = email.trim().toLowerCase();
        if (!EMAIL_REGEX.test(cleanEmail)) {
            return res.status(400).json({ error: 'Invalid email format.' });
        }

        // Clamp source to 60 chars, default to 'unknown'
        const cleanSource = source ? String(source).slice(0, 60) : 'unknown';

        // Extract IP and user agent
        const forwarded = req.headers['x-forwarded-for'];
        const ip = forwarded ? forwarded.split(',')[0].trim() : (req.socket?.remoteAddress || null);
        const userAgent = req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 200) : null;

        // Upsert: insert or update if exists
        // If email exists with status=unsubscribed, set status=subscribed and clear unsubscribed_at
        // If email exists with status=subscribed, update last_ip/user_agent (idempotent)
        console.log(`[Subscribe] Attempting insert for ${cleanEmail}`);
        
        const result = await pool.query(`
            INSERT INTO newsletter_subscribers (email, source, status, last_ip, user_agent)
            VALUES ($1, $2, 'subscribed', $3, $4)
            ON CONFLICT (email) DO UPDATE SET
                status = 'subscribed',
                unsubscribed_at = NULL,
                last_ip = EXCLUDED.last_ip,
                user_agent = EXCLUDED.user_agent
            RETURNING id
        `, [cleanEmail, cleanSource, ip, userAgent]);

        console.log(`[Subscribe] Success: email=${cleanEmail} source=${cleanSource} id=${result.rows[0]?.id}`);

        // Send notification to owner
        if (process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL) {
            try {
                await sgMail.send({
                    to: 'rlajoux@gmail.com',
                    from: process.env.SENDGRID_FROM_EMAIL,
                    subject: `New newsletter subscriber: ${cleanEmail}`,
                    text: `New newsletter subscription!

Email: ${cleanEmail}
Source: ${cleanSource}
Time: ${new Date().toISOString()}

—
StayHustler
`
                });
                console.log(`[Subscribe] Owner notification sent`);
            } catch (notifyError) {
                console.error(`[Subscribe] Owner notification failed:`, notifyError.message);
            }
        }

        res.json({ ok: true });

    } catch (err) {
        console.error(`[Subscribe] FAILED: ${err.message}`);
        console.error(`[Subscribe] Stack: ${err.stack}`);
        res.status(500).json({ error: 'Subscription failed.' });
    }
});

// GET /api/subscribers/count - Get subscriber count (for verification)
app.get('/api/subscribers/count', async (req, res) => {
    try {
        if (!pool) {
            return res.json({ count: 0 });
        }

        const result = await pool.query(`
            SELECT COUNT(*) as count FROM newsletter_subscribers WHERE status = 'subscribed'
        `);
        const count = parseInt(result.rows[0].count, 10);
        res.json({ count });

    } catch (err) {
        console.error('[SubscriberCount] Error:', err.message);
        res.json({ count: 0 });
    }
});

// GET /api/subscribers/status - Get status breakdown
app.get('/api/subscribers/status', async (req, res) => {
    try {
        if (!pool) {
            return res.json({ subscribed: 0, unsubscribed: 0 });
        }

        const result = await pool.query(`
            SELECT 
                SUM(CASE WHEN status = 'subscribed' THEN 1 ELSE 0 END)::int as subscribed,
                SUM(CASE WHEN status = 'unsubscribed' THEN 1 ELSE 0 END)::int as unsubscribed
            FROM newsletter_subscribers
        `);
        res.json({
            subscribed: result.rows[0].subscribed || 0,
            unsubscribed: result.rows[0].unsubscribed || 0
        });

    } catch (err) {
        console.error('[SubscriberStatus] Error:', err.message);
        res.json({ subscribed: 0, unsubscribed: 0 });
    }
});

// GET /unsubscribe - One-click unsubscribe endpoint
app.get('/unsubscribe', async (req, res) => {
    try {
        const { email, token } = req.query;

        // Validate parameters
        if (!email || !token) {
            return res.status(400).send(`
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Invalid Link</title>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
                               max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
                        h1 { color: #c55; }
                    </style>
                </head>
                <body>
                    <h1>Invalid Unsubscribe Link</h1>
                    <p>This link is missing required parameters.</p>
                </body>
                </html>
            `);
        }

        const cleanEmail = email.trim().toLowerCase();

        // Verify token
        if (!verifyEmailToken(cleanEmail, token)) {
            console.log(`[Unsubscribe] Invalid token for ${cleanEmail}`);
            return res.status(400).send(`
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Invalid Link</title>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
                               max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
                        h1 { color: #c55; }
                    </style>
                </head>
                <body>
                    <h1>Invalid Unsubscribe Link</h1>
                    <p>This unsubscribe link is invalid or has expired.</p>
                </body>
                </html>
            `);
        }

        // Check if DB is available
        if (!pool) {
            return res.status(500).send(`
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Error</title>
                </head>
                <body>
                    <h1>Service Unavailable</h1>
                    <p>Please try again later.</p>
                </body>
                </html>
            `);
        }

        // Update subscriber status
        await pool.query(`
            UPDATE newsletter_subscribers
            SET status = 'unsubscribed', unsubscribed_at = now()
            WHERE email = $1
        `, [cleanEmail]);

        console.log(`[Unsubscribe] Success: ${cleanEmail}`);

        // Return success page
        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Unsubscribed</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
                           max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; 
                           color: #2d2a26; }
                    h1 { color: #5a8a4a; }
                    p { line-height: 1.6; color: #6b6560; }
                </style>
            </head>
            <body>
                <h1>You have been unsubscribed</h1>
                <p>You will no longer receive weekly tips from StayHustler.</p>
                <p>If this was a mistake, you can subscribe again at <a href="https://stayhustler.com">stayhustler.com</a>.</p>
            </body>
            </html>
        `);

    } catch (err) {
        console.error('[Unsubscribe] Error:', err.message);
        res.status(500).send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Error</title>
            </head>
            <body>
                <h1>An error occurred</h1>
                <p>Please try again later.</p>
            </body>
            </html>
        `);
    }
});

// ============================================================
// POST-PAYMENT DELIVERY
// ============================================================
// Send generated request to traveler via email after payment
// ============================================================

const sgMail = require('@sendgrid/mail');

// Configure SendGrid if API key is set
if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

// POST /api/deliver-request - Email generated content to traveler
app.post('/api/deliver-request', async (req, res) => {
    try {
        // Check if SendGrid is configured
        if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
            console.error('[Delivery] SendGrid not configured');
            return res.status(502).json({ error: 'Delivery failed.' });
        }

        // Check if DB is available
        if (!pool) {
            console.error('[Delivery] Database not configured');
            return res.status(502).json({ error: 'Delivery failed.' });
        }

        const { email, booking, context, order } = req.body;

        // Validate email
        if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email)) {
            return res.status(400).json({ error: 'Valid email is required.' });
        }

        // Validate required fields
        if (!booking || !context) {
            return res.status(400).json({ error: 'Booking and context are required.' });
        }

        const cleanEmail = email.trim().toLowerCase();

        try {
            // Generate the request using existing logic
            console.log(`[Delivery] Generating request for ${cleanEmail}`);
            const { result: generated, finalSource } = await generateRequestPayload(booking, context);
            
            console.log(`[Delivery] Generation complete with source=${finalSource}`);

            // Build email content
            const emailText = `Your StayHustler upgrade request is ready!

Hotel: ${booking.hotel || 'Unknown'}
Check-in: ${booking.checkin || 'Unknown'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EMAIL SUBJECT FOR THE HOTEL:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${generated.email_subject}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EMAIL BODY TO SEND TO THE HOTEL:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${generated.email_body}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TIMING GUIDANCE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${generated.timing_guidance.map((tip, i) => `${i + 1}. ${tip}`).join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FALLBACK SCRIPT (if email doesn't work):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${generated.fallback_script}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

IMPORTANT: You send this to the hotel yourself. We do not contact the hotel on your behalf. Copy the subject and body above, then email them to your hotel's reservations or front desk.

Questions? Visit https://stayhustler.com

—
StayHustler
`;

            // Send email via SendGrid
            const msg = {
                to: cleanEmail,
                from: process.env.SENDGRID_FROM_EMAIL,
                subject: 'Your StayHustler request is ready',
                text: emailText
            };

            await sgMail.send(msg);
            console.log(`[Delivery] Email sent to ${cleanEmail}`);

            // Log to database
            await pool.query(`
                INSERT INTO request_deliveries (email, booking, context, generated, status)
                VALUES ($1, $2, $3, $4, 'sent')
            `, [cleanEmail, JSON.stringify(booking), JSON.stringify(context), JSON.stringify(generated)]);

            // Send notification to owner
            try {
                const notificationMsg = {
                    to: 'rlajoux@gmail.com',
                    from: process.env.SENDGRID_FROM_EMAIL,
                    subject: `New StayHustler payment: ${booking.hotel || 'Unknown hotel'}`,
                    text: `New payment received!

Customer: ${cleanEmail}
Hotel: ${booking.hotel || 'Unknown'}
City: ${booking.city || 'Unknown'}
Check-in: ${booking.checkin || 'Unknown'}
Check-out: ${booking.checkout || 'Unknown'}
Room: ${booking.room || 'Not specified'}
Channel: ${booking.channel || 'Not specified'}

Request preference: ${context.askPreference || 'Unknown'}
Generation source: ${finalSource}

Time: ${new Date().toISOString()}
`
                };
                await sgMail.send(notificationMsg);
                console.log(`[Delivery] Owner notification sent`);
            } catch (notifyError) {
                console.error(`[Delivery] Owner notification failed:`, notifyError.message);
                // Don't fail the request if notification fails
            }

            console.log(`[Delivery] Success for ${cleanEmail} hotel=${booking.hotel || 'unknown'}`);
            res.json({ ok: true });

        } catch (sendError) {
            console.error(`[Delivery] SendGrid error for ${cleanEmail}:`, sendError.message);

            // Log failure to database
            try {
                await pool.query(`
                    INSERT INTO request_deliveries (email, booking, context, generated, status, error)
                    VALUES ($1, $2, $3, $4, 'failed', $5)
                `, [
                    cleanEmail,
                    JSON.stringify(booking),
                    JSON.stringify(context),
                    JSON.stringify({}),
                    sendError.message
                ]);
            } catch (dbError) {
                console.error(`[Delivery] Failed to log error to DB:`, dbError.message);
            }

            return res.status(502).json({ error: 'Delivery failed.' });
        }

    } catch (err) {
        console.error('[Delivery] Error:', err.message);
        res.status(502).json({ error: 'Delivery failed.' });
    }
});

// ===== POST /api/resend-delivery =====
// Resends a previously generated request email without calling Gemini again
app.post('/api/resend-delivery', resendRateLimit, async (req, res) => {
    try {
        const { delivery_id, email } = req.body;

        // Validate inputs
        if (!delivery_id || typeof delivery_id !== 'string') {
            return res.status(400).json({ error: 'Missing delivery_id' });
        }

        if (!email || typeof email !== 'string') {
            return res.status(400).json({ error: 'Missing email' });
        }

        const cleanEmail = email.trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(cleanEmail)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        console.log(`[Resend] Resending delivery ${delivery_id} to ${cleanEmail}`);

        // Load original delivery from database
        const result = await pool.query(`
            SELECT id, email, booking, context, generated, status 
            FROM request_deliveries 
            WHERE id = $1 
            ORDER BY created_at DESC 
            LIMIT 1
        `, [delivery_id]);

        if (result.rows.length === 0) {
            console.log(`[Resend] Delivery ID not found: ${delivery_id}`);
            return res.status(404).json({ error: 'Delivery not found' });
        }

        const originalDelivery = result.rows[0];

        // Check if original delivery was successful
        if (originalDelivery.status !== 'sent') {
            console.log(`[Resend] Original delivery status: ${originalDelivery.status}`);
            return res.status(400).json({ error: 'Original delivery was not successful' });
        }

        // Use stored generated content (no Gemini call)
        const generated = originalDelivery.generated;
        if (!generated || !generated.email_subject || !generated.email_body) {
            console.log(`[Resend] No valid generated content in delivery ${delivery_id}`);
            return res.status(500).json({ error: 'No content to resend' });
        }

        console.log(`[Resend] Using stored content from delivery ${delivery_id}`);

        // Compose email
        const subject = generated.email_subject;
        const emailBody = `
${generated.email_body}

────────────────────────────────

✓ When to ask (timing matters):
${(generated.timing_guidance || []).map((tip, i) => `  ${i + 1}. ${tip.replace(/<\/?strong>/g, '')}`).join('\n')}

✓ At the front desk, say:
  "${generated.fallback_script || 'If any upgraded rooms are expected to remain available this evening, I\'d be grateful to be considered.'}"

────────────────────────────────

Upgrades depend on availability and hotel discretion. This guidance improves odds, not guarantees outcomes.

Best of luck on your stay!
– StayHustler

────────────────────────────────
You received this because you purchased insider guidance at stayhustler.com.
        `.trim();

        // Send email via SendGrid
        const msg = {
            to: cleanEmail,
            from: SENDGRID_FROM_EMAIL,
            subject: `Your StayHustler request: ${subject}`,
            text: emailBody,
            html: emailBody.replace(/\n/g, '<br>')
        };

        try {
            await sgMail.send(msg);
            console.log(`[Resend] Email sent successfully to ${cleanEmail}`);

            // Insert new audit row
            await pool.query(`
                INSERT INTO request_deliveries (email, booking, context, generated, status)
                VALUES ($1, $2, $3, $4, 'sent')
            `, [
                cleanEmail,
                originalDelivery.booking,
                originalDelivery.context,
                JSON.stringify(generated)
            ]);

            res.json({ ok: true });

        } catch (sendError) {
            console.error(`[Resend] SendGrid error:`, sendError.message);

            // Log failure
            try {
                await pool.query(`
                    INSERT INTO request_deliveries (email, booking, context, generated, status, error)
                    VALUES ($1, $2, $3, $4, 'failed', $5)
                `, [
                    cleanEmail,
                    originalDelivery.booking,
                    originalDelivery.context,
                    JSON.stringify(generated),
                    sendError.message
                ]);
            } catch (dbError) {
                console.error(`[Resend] Failed to log error:`, dbError.message);
            }

            return res.status(502).json({ error: 'Failed to send email' });
        }

    } catch (err) {
        console.error('[Resend] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ============================================================
// STRIPE TEST ENDPOINT
// ============================================================
// COUPON DEFINITIONS (server-side source of truth)
// ============================================================
const COUPONS = {
    'UPGRADE10': { type: 'percent', value: 10 },   // 10% off
    'WELCOME5': { type: 'fixed', value: 500 },     // $5 off (in cents)
    'TRYITFREE': { type: 'percent', value: 100 },  // 100% off (free trial, one-time)
    'ADMINFREE100': { type: 'percent', value: 100 } // 100% off (unlimited admin use)
};

const BASE_PRICE_CENTS = 700; // $7.00

// Validate and calculate discount for a coupon code
function validateCoupon(code) {
    if (!code) return null;
    const normalized = code.toUpperCase().trim();
    const coupon = COUPONS[normalized];
    if (!coupon) return null;

    let discountCents = 0;
    if (coupon.type === 'percent') {
        discountCents = Math.round(BASE_PRICE_CENTS * (coupon.value / 100));
    } else if (coupon.type === 'fixed') {
        discountCents = coupon.value;
    }

    const finalCents = Math.max(0, BASE_PRICE_CENTS - discountCents);

    return {
        code: normalized,
        type: coupon.type,
        value: coupon.value,
        discount_cents: discountCents,
        final_cents: finalCents
    };
}

// ============================================================
// DESK-ASK COPY GENERATION (Gemini-powered)
// ============================================================
// Generates the "If you ask at the desk" content block
// Uses a dedicated prompt with strict JSON schema
// ============================================================

// Hardcoded fallback for desk-ask content (used if Gemini fails)
const DESK_ASK_FALLBACK = {
    title: "If you ask at the desk",
    sections: [
        {
            heading: "When to ask",
            bullets: [
                "Ask during check-in, before handing over your ID or credit card",
                "Mid-afternoon arrivals often have better availability",
                "Avoid asking when the lobby is busy or staff seem rushed"
            ]
        },
        {
            heading: "How to reference the email",
            bullets: [
                "Mention you sent an email ahead of time, but don't push",
                "Say something like: 'I reached out earlier about availability'",
                "If they haven't seen it, move on gracefully"
            ]
        },
        {
            heading: "What to say",
            bullets: [
                "Ask if any upgraded rooms happen to be available tonight",
                "Express flexibility: 'I'm happy with whatever works best'",
                "Thank them regardless of the outcome"
            ]
        }
    ],
    script: {
        intro: "Here's a natural way to ask at check-in:",
        line1: "Hi, I sent an email earlier about my stay. If any upgraded rooms are expected to be available this evening, I'd be grateful to be considered.",
        line2: "I completely understand if not — just thought I'd ask."
    },
    tone_reminders: [
        "Smile and make eye contact",
        "Keep a calm, unhurried demeanor",
        "Avoid sounding entitled or demanding"
    ]
};

// Validate desk-ask copy structure
function validateDeskAskCopy(data) {
    if (!data || typeof data !== 'object') return false;
    if (typeof data.title !== 'string') return false;
    if (!Array.isArray(data.sections) || data.sections.length !== 3) return false;

    const requiredHeadings = ['When to ask', 'How to reference the email', 'What to say'];
    for (let i = 0; i < 3; i++) {
        const section = data.sections[i];
        if (!section || typeof section.heading !== 'string') return false;
        if (section.heading !== requiredHeadings[i]) return false;
        if (!Array.isArray(section.bullets) || section.bullets.length < 2 || section.bullets.length > 3) return false;
        for (const bullet of section.bullets) {
            if (typeof bullet !== 'string' || bullet.length > 120) return false;
        }
    }

    if (!data.script || typeof data.script !== 'object') return false;
    if (typeof data.script.intro !== 'string') return false;
    if (typeof data.script.line1 !== 'string') return false;
    if (typeof data.script.line2 !== 'string') return false;

    if (!Array.isArray(data.tone_reminders) || data.tone_reminders.length !== 3) return false;
    for (const reminder of data.tone_reminders) {
        if (typeof reminder !== 'string') return false;
    }

    return true;
}

// Call Gemini specifically for desk-ask content (lower temperature, stricter prompt)
async function callGeminiDeskAsk() {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        throw new Error('GEMINI_API_KEY not configured');
    }

    const systemInstruction = "You write concise, high-converting UI microcopy for a travel product. Output MUST be valid JSON only, matching the provided schema exactly. No extra keys. No markdown. No commentary.";

    const userPrompt = `Generate content for a UI card titled 'If you ask at the desk' that helps a hotel guest ask politely for an upgrade or flexibility.
Return JSON matching this schema exactly:
{title:string, sections:[{heading:string, bullets:string[]}], script:{intro:string, line1:string, line2:string}, tone_reminders:string[]}
Rules:
- title must be exactly "If you ask at the desk"
- sections headings must be exactly: 'When to ask', 'How to reference the email', 'What to say' (in that order)
- 2-3 bullets per section, each bullet <= 120 characters
- script.intro 1 sentence max; script.line1 and script.line2 each 1 sentence max
- tone_reminders must contain exactly 3 items and include: smile, calm demeanor, and avoiding entitlement
- Keep it practical: recommend timing during check-in and how to mention you emailed earlier without pressure.
- Output JSON only.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            systemInstruction: {
                parts: [{ text: systemInstruction }]
            },
            contents: [{
                parts: [{
                    text: userPrompt
                }]
            }],
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 800,
                responseMimeType: "application/json"
            }
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('[DeskAsk] Gemini API error:', response.status, errorText);
        throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!generatedText) {
        throw new Error('No content generated');
    }

    // Parse and clean JSON
    let cleanedText = generatedText.trim();
    if (cleanedText.startsWith('```json')) cleanedText = cleanedText.slice(7);
    if (cleanedText.startsWith('```')) cleanedText = cleanedText.slice(3);
    if (cleanedText.endsWith('```')) cleanedText = cleanedText.slice(0, -3);

    return JSON.parse(cleanedText.trim());
}

// GET /api/desk-ask-copy - Returns Gemini-generated desk-ask content
app.get('/api/desk-ask-copy', async (req, res) => {
    const requestId = Math.random().toString(36).substring(2, 9);
    console.log(`[DeskAsk:${requestId}] GET /api/desk-ask-copy`);

    // Set cache headers (1 hour)
    res.setHeader('Cache-Control', 'public, max-age=3600');

    try {
        const result = await callGeminiDeskAsk();

        // Validate the response structure
        if (!validateDeskAskCopy(result)) {
            console.warn(`[DeskAsk:${requestId}] Invalid Gemini response structure, using fallback`);
            return res.json(DESK_ASK_FALLBACK);
        }

        console.log(`[DeskAsk:${requestId}] ✓ Gemini response valid`);
        return res.json(result);

    } catch (error) {
        console.error(`[DeskAsk:${requestId}] Error: ${error.message}`);
        // Return fallback on any error
        return res.json(DESK_ASK_FALLBACK);
    }
});

// ============================================================
// Creates a Checkout Session with optional coupon support
// Returns checkout_url for redirect
// ============================================================

app.post('/api/stripe/test', async (req, res) => {
    try {
        // Check if Stripe is initialized
        if (!stripe) {
            console.error('[Stripe] STRIPE_SECRET_KEY not configured');
            return res.status(500).json({
                error: 'Missing STRIPE_SECRET_KEY',
                message: 'Stripe is not configured on the server'
            });
        }

        // Extract coupon code and request type from request body
        const { coupon_code, request_type } = req.body || {};

        // Get request type config (default to 'upgrade' for backward compatibility)
        const requestType = request_type || 'upgrade';
        const rtConfig = getRequestTypeConfig(requestType);

        // Validate coupon and calculate final amount
        let finalAmountCents = BASE_PRICE_CENTS;
        let appliedCoupon = null;

        if (coupon_code) {
            appliedCoupon = validateCoupon(coupon_code);
            if (appliedCoupon) {
                finalAmountCents = appliedCoupon.final_cents;
                console.log(`[Stripe] Coupon ${appliedCoupon.code} applied: $${(appliedCoupon.discount_cents / 100).toFixed(2)} off`);
            } else {
                console.log(`[Stripe] Invalid coupon code: ${coupon_code}`);
            }
        }

        console.log(`[Stripe] Creating Checkout Session for $${(finalAmountCents / 100).toFixed(2)}, requestType=${requestType}`);

        // Build product name based on request type
        let productName = `StayHustler ${rtConfig.label} Request`;
        if (appliedCoupon) {
            productName += ` (${appliedCoupon.code} applied)`;
        }

        // Create Checkout Session with metadata
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: productName,
                        },
                        unit_amount: finalAmountCents,
                    },
                    quantity: 1,
                },
            ],
            metadata: {
                request_type: requestType,
                coupon_code: appliedCoupon?.code || null
            },
            success_url: `${API_BASE_URL}/post-checkout?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${BASE_URL}/payment.html`,
        });

        console.log('[Stripe] Checkout Session created:', session.id);

        return res.json({
            ok: true,
            checkout_url: session.url,
            applied_coupon: appliedCoupon
        });

    } catch (error) {
        console.error('[Stripe] Error creating Checkout Session:', error.message);

        // Don't expose Stripe error details to client
        return res.status(502).json({
            error: 'Stripe test failed',
            message: 'Unable to create checkout session'
        });
    }
});

// ============================================================
// COUPON VALIDATION ENDPOINT
// ============================================================
// Validates a coupon code and returns discount info
// ============================================================

app.post('/api/validate-coupon', (req, res) => {
    const { code } = req.body || {};

    if (!code) {
        return res.json({ valid: false, error: 'No code provided' });
    }

    const result = validateCoupon(code);

    if (!result) {
        return res.json({ valid: false, error: 'Invalid code' });
    }

    return res.json({
        valid: true,
        code: result.code,
        type: result.type,
        value: result.value,
        discount_cents: result.discount_cents,
        final_cents: result.final_cents,
        base_cents: BASE_PRICE_CENTS
    });
});

// ============================================================
// POST-CHECKOUT: VERIFY STRIPE PAYMENT & SET ACCESS COOKIE
// ============================================================
// After Stripe redirects back, verify the session is paid,
// set an HttpOnly cookie with JWT, then redirect to /results.
// ============================================================

app.get('/post-checkout', async (req, res) => {
    const { session_id } = req.query;

    console.log('[Post-Checkout] Processing session:', session_id);

    // Validate session_id is present
    if (!session_id) {
        console.error('[Post-Checkout] No session_id provided');
        return res.redirect('/?error=missing_session');
    }

    // Check Stripe is configured
    if (!stripe) {
        console.error('[Post-Checkout] Stripe not configured');
        return res.redirect('/?error=payment_not_configured');
    }

    try {
        // Retrieve the Checkout Session from Stripe
        const session = await stripe.checkout.sessions.retrieve(session_id);

        console.log('[Post-Checkout] Session status:', session.payment_status);

        // Verify payment was successful
        if (session.payment_status !== 'paid') {
            console.error('[Post-Checkout] Payment not completed:', session.payment_status);
            return res.redirect('/payment.html?error=payment_not_completed');
        }

        // Payment verified - create access token
        const email = session.customer_details?.email || null;
        const token = createAccessToken(session_id, email);

        // Set the access cookie
        setAccessCookie(res, token);

        console.log('[Post-Checkout] Access granted, redirecting to results');

        // Redirect to results page
        return res.redirect('/results');

    } catch (err) {
        console.error('[Post-Checkout] Stripe error:', err.message);

        // Handle specific Stripe errors
        if (err.type === 'StripeInvalidRequestError') {
            return res.redirect('/?error=invalid_session');
        }

        return res.redirect('/?error=verification_failed');
    }
});

// ============================================================
// FREE ACCESS GRANT (FOR FREE COUPONS)
// ============================================================
// When a 100% discount coupon is applied, skip Stripe and grant access directly.
// This is called by the frontend when final_cents === 0.
// ============================================================

app.post('/api/grant-free-access', async (req, res) => {
    const { coupon_code, email } = req.body || {};

    console.log('[Free Access] Request with coupon:', coupon_code);

    // Validate the coupon gives 100% off
    const result = validateCoupon(coupon_code);

    if (!result || result.final_cents !== 0) {
        console.error('[Free Access] Invalid or non-free coupon:', coupon_code);
        return res.status(400).json({
            error: 'Invalid coupon',
            message: 'This coupon does not qualify for free access'
        });
    }

    // Create a pseudo-session ID for free access
    const freeSessionId = `free_${coupon_code}_${Date.now()}`;
    const token = createAccessToken(freeSessionId, email || null);

    // Set the access cookie
    setAccessCookie(res, token);

    console.log('[Free Access] Granted for coupon:', coupon_code);

    return res.json({
        ok: true,
        redirect_url: `${API_BASE_URL}/results`
    });
});

// GET endpoint for free access - browser redirect (avoids third-party cookie issues)
app.get('/free-access', (req, res) => {
    const { code, email, data } = req.query;

    console.log('[Free Access GET] Request with coupon:', code);

    if (!code) {
        return res.redirect(`${BASE_URL}/?error=missing_code`);
    }

    // Validate the coupon gives 100% off
    const result = validateCoupon(code);

    if (!result || result.final_cents !== 0) {
        console.error('[Free Access GET] Invalid or non-free coupon:', code);
        return res.redirect(`${BASE_URL}/?error=invalid_coupon`);
    }

    // Create a pseudo-session ID for free access
    const freeSessionId = `free_${code}_${Date.now()}`;
    const token = createAccessToken(freeSessionId, email || null);

    // Set the access cookie (same-origin, so it will work)
    setAccessCookie(res, token);

    console.log('[Free Access GET] Granted, redirecting to results');

    // Redirect to results page with data payload (for cross-domain localStorage transfer)
    const redirectUrl = data ? `/results?data=${encodeURIComponent(data)}` : '/results';
    return res.redirect(redirectUrl);
});

// ============================================================
// RESULTS PAGE (PROTECTED)
// ============================================================
// Serves the results page. Requires valid sh_access cookie.
// Returns HTML that fetches actual content from /api/results.
// ============================================================

app.get('/results', requireAccess, (req, res) => {
    console.log('[Results] Serving results page for session:', req.paidSession.sid);

    // Send the results shell page
    // The shell will call /api/results to get the actual content
    res.sendFile(path.join(__dirname, 'results-shell.html'));
});

// ============================================================
// API RESULTS (PROTECTED)
// ============================================================
// Returns the results data as JSON. Requires valid sh_access cookie.
// Frontend fetches this to populate the results page.
// ============================================================

app.get('/api/results', requireAccess, (req, res) => {
    console.log('[API Results] Serving results data for session:', req.paidSession.sid);

    // Return confirmation that access is valid
    // The actual content is rendered client-side using localStorage data
    // (This could be enhanced to store/retrieve data server-side in the future)
    return res.json({
        ok: true,
        access_granted: true,
        session_id: req.paidSession.sid,
        email: req.paidSession.email,
        expires_at: new Date(req.paidSession.exp * 1000).toISOString(),
        // TODO: In a future enhancement, store the generated request server-side
        // and return it here instead of relying on localStorage
        message: 'Access verified. Content loaded from localStorage.'
    });
});

// ============================================================
// BLOCK DIRECT ACCESS TO results.html
// ============================================================
// Redirect any direct access to /results.html to the protected /results route.
// This ensures users can't bypass the access control.
// ============================================================

app.get('/results.html', (req, res) => {
    console.log('[Access] Blocked direct access to results.html, redirecting');
    return res.redirect('/results');
});

// ============================================================
// ADMIN ROUTES (HTTP BASIC AUTH PROTECTED)
// ============================================================
// Dashboard and data views for newsletter subscribers and deliveries
// All routes under /admin require authentication
// ============================================================

const ADMIN_PATH = process.env.ADMIN_PATH || '/admin';

// Helper: Format date for display
function formatDate(date) {
    if (!date) return '';
    return new Date(date).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Helper: Truncate text
function truncateText(text, maxLen = 80) {
    if (!text) return '';
    return text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
}

// Helper: Generate pagination HTML
function paginationHTML(currentPage, totalPages, baseUrl, queryParams = {}) {
    if (totalPages <= 1) return '';
    
    const params = new URLSearchParams(queryParams);
    let html = '<div class="pagination">';
    
    if (currentPage > 1) {
        params.set('page', currentPage - 1);
        html += `<a href="${baseUrl}?${params.toString()}">← Previous</a>`;
    }
    
    html += `<span>Page ${currentPage} of ${totalPages}</span>`;
    
    if (currentPage < totalPages) {
        params.set('page', currentPage + 1);
        html += `<a href="${baseUrl}?${params.toString()}">Next →</a>`;
    }
    
    html += '</div>';
    return html;
}

// Helper: Common admin HTML layout
function adminLayout(title, content) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <title>${title} - StayHustler Admin</title>
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            margin: 0;
            padding: 20px;
            background: #fafafa;
            color: #333;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        h1 {
            margin: 0 0 10px;
            font-size: 28px;
            font-weight: 600;
        }
        .breadcrumb {
            margin-bottom: 20px;
            color: #666;
            font-size: 14px;
        }
        .breadcrumb a {
            color: #0066cc;
            text-decoration: none;
        }
        .breadcrumb a:hover {
            text-decoration: underline;
        }
        .dashboard-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .card {
            background: white;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .card h2 {
            margin: 0 0 10px;
            font-size: 14px;
            font-weight: 500;
            text-transform: uppercase;
            color: #666;
            letter-spacing: 0.5px;
        }
        .card .number {
            font-size: 36px;
            font-weight: 600;
            margin-bottom: 10px;
        }
        .card .meta {
            font-size: 13px;
            color: #888;
        }
        .card a {
            display: inline-block;
            margin-top: 10px;
            color: #0066cc;
            text-decoration: none;
            font-size: 14px;
        }
        .card a:hover {
            text-decoration: underline;
        }
        .filters {
            background: white;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .filters label {
            margin-right: 10px;
            font-size: 14px;
        }
        .filters select, .filters input {
            padding: 5px 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
        }
        .filters button {
            padding: 6px 15px;
            background: #0066cc;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        .filters button:hover {
            background: #0052a3;
        }
        .filters a {
            margin-left: 15px;
            color: #0066cc;
            text-decoration: none;
            font-size: 14px;
        }
        .filters a:hover {
            text-decoration: underline;
        }
        table {
            width: 100%;
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            border-collapse: collapse;
        }
        th {
            background: #f5f5f5;
            padding: 12px 15px;
            text-align: left;
            font-weight: 600;
            font-size: 13px;
            text-transform: uppercase;
            color: #666;
            letter-spacing: 0.5px;
        }
        td {
            padding: 12px 15px;
            border-top: 1px solid #eee;
            font-size: 14px;
        }
        tr:hover {
            background: #fafafa;
        }
        .badge {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 3px;
            font-size: 12px;
            font-weight: 500;
        }
        .badge-success {
            background: #d4edda;
            color: #155724;
        }
        .badge-danger {
            background: #f8d7da;
            color: #721c24;
        }
        .badge-secondary {
            background: #e2e3e5;
            color: #383d41;
        }
        .pagination {
            margin-top: 20px;
            text-align: center;
            font-size: 14px;
        }
        .pagination a {
            display: inline-block;
            padding: 8px 15px;
            margin: 0 5px;
            background: white;
            border: 1px solid #ddd;
            border-radius: 4px;
            color: #0066cc;
            text-decoration: none;
        }
        .pagination a:hover {
            background: #f5f5f5;
        }
        .pagination span {
            display: inline-block;
            padding: 8px 15px;
            margin: 0 5px;
        }
        .empty {
            text-align: center;
            padding: 40px;
            color: #999;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        ${content}
    </div>
</body>
</html>`;
}

// GET /admin - Dashboard
app.get(ADMIN_PATH, basicAuth, async (req, res) => {
    try {
        if (!pool) {
            return res.status(503).send('Database not configured');
        }
        
        // Get counts
        const subscriberStats = await pool.query(`
            SELECT 
                COUNT(*)::int as total,
                SUM(CASE WHEN status = 'subscribed' THEN 1 ELSE 0 END)::int as subscribed,
                SUM(CASE WHEN status = 'unsubscribed' THEN 1 ELSE 0 END)::int as unsubscribed
            FROM newsletter_subscribers
        `);
        
        const deliveryStats = await pool.query(`
            SELECT 
                COUNT(*)::int as total,
                SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END)::int as sent,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)::int as failed
            FROM request_deliveries
        `);
        
        const subStats = subscriberStats.rows[0];
        const delStats = deliveryStats.rows[0];
        
        const content = `
            <h1>StayHustler Admin</h1>
            <p class="breadcrumb">Dashboard</p>
            
            <div class="dashboard-grid">
                <div class="card">
                    <h2>Newsletter Subscribers</h2>
                    <div class="number">${subStats.total || 0}</div>
                    <div class="meta">
                        ${subStats.subscribed || 0} subscribed · ${subStats.unsubscribed || 0} unsubscribed
                    </div>
                    <a href="${ADMIN_PATH}/subscribers">View all subscribers →</a>
                </div>
                
                <div class="card">
                    <h2>Request Deliveries</h2>
                    <div class="number">${delStats.total || 0}</div>
                    <div class="meta">
                        ${delStats.sent || 0} sent · ${delStats.failed || 0} failed
                    </div>
                    <a href="${ADMIN_PATH}/deliveries">View all deliveries →</a>
                </div>
            </div>
        `;
        
        res.send(adminLayout('Dashboard', content));
        
    } catch (err) {
        console.error('[Admin] Dashboard error:', err.message);
        res.status(500).send('Internal server error');
    }
});

// GET /admin/subscribers - View subscribers
app.get(`${ADMIN_PATH}/subscribers`, basicAuth, async (req, res) => {
    try {
        if (!pool) {
            return res.status(503).send('Database not configured');
        }
        
        // Parse query params
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
        const statusFilter = req.query.status; // 'subscribed' | 'unsubscribed' | undefined
        const offset = (page - 1) * limit;
        
        // Build query
        let whereClause = '';
        let queryParams = [limit, offset];
        
        if (statusFilter === 'subscribed' || statusFilter === 'unsubscribed') {
            whereClause = 'WHERE status = $3';
            queryParams.push(statusFilter);
        }
        
        // Get total count
        const countQuery = `SELECT COUNT(*)::int as total FROM newsletter_subscribers ${whereClause}`;
        const countParams = statusFilter ? [statusFilter] : [];
        const countResult = await pool.query(countQuery, countParams);
        const totalCount = countResult.rows[0].total;
        const totalPages = Math.ceil(totalCount / limit);
        
        // Get subscribers
        const query = `
            SELECT email, status, source, created_at, unsubscribed_at
            FROM newsletter_subscribers
            ${whereClause}
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
        `;
        const result = await pool.query(query, queryParams);
        
        // Build table HTML
        let tableHTML = '';
        if (result.rows.length === 0) {
            tableHTML = '<div class="empty">No subscribers found</div>';
        } else {
            tableHTML = `
                <table>
                    <thead>
                        <tr>
                            <th>Email</th>
                            <th>Status</th>
                            <th>Source</th>
                            <th>Created</th>
                            <th>Unsubscribed</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${result.rows.map(row => `
                            <tr>
                                <td>${row.email}</td>
                                <td>
                                    <span class="badge ${row.status === 'subscribed' ? 'badge-success' : 'badge-secondary'}">
                                        ${row.status}
                                    </span>
                                </td>
                                <td>${row.source}</td>
                                <td>${formatDate(row.created_at)}</td>
                                <td>${formatDate(row.unsubscribed_at)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }
        
        // Build filter form
        const urlParams = { limit };
        if (statusFilter) urlParams.status = statusFilter;
        
        const content = `
            <h1>Newsletter Subscribers</h1>
            <p class="breadcrumb"><a href="${ADMIN_PATH}">Dashboard</a> / Subscribers</p>
            
            <div class="filters">
                <form method="get" style="display: inline-block;">
                    <label>Status:</label>
                    <select name="status" onchange="this.form.submit()">
                        <option value="">All</option>
                        <option value="subscribed" ${statusFilter === 'subscribed' ? 'selected' : ''}>Subscribed</option>
                        <option value="unsubscribed" ${statusFilter === 'unsubscribed' ? 'selected' : ''}>Unsubscribed</option>
                    </select>
                    <input type="hidden" name="limit" value="${limit}">
                </form>
                <a href="${ADMIN_PATH}/api/subscribers.csv${statusFilter ? '?status=' + statusFilter : ''}">Download CSV</a>
            </div>
            
            ${tableHTML}
            
            ${paginationHTML(page, totalPages, `${ADMIN_PATH}/subscribers`, urlParams)}
        `;
        
        res.send(adminLayout('Subscribers', content));
        
    } catch (err) {
        console.error('[Admin] Subscribers error:', err.message);
        res.status(500).send('Internal server error');
    }
});

// GET /admin/deliveries - View request deliveries
app.get(`${ADMIN_PATH}/deliveries`, basicAuth, async (req, res) => {
    try {
        if (!pool) {
            return res.status(503).send('Database not configured');
        }
        
        // Parse query params
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
        const statusFilter = req.query.status; // 'sent' | 'failed' | undefined
        const offset = (page - 1) * limit;
        
        // Build query
        let whereClause = '';
        let queryParams = [limit, offset];
        
        if (statusFilter === 'sent' || statusFilter === 'failed') {
            whereClause = 'WHERE status = $3';
            queryParams.push(statusFilter);
        }
        
        // Get total count
        const countQuery = `SELECT COUNT(*)::int as total FROM request_deliveries ${whereClause}`;
        const countParams = statusFilter ? [statusFilter] : [];
        const countResult = await pool.query(countQuery, countParams);
        const totalCount = countResult.rows[0].total;
        const totalPages = Math.ceil(totalCount / limit);
        
        // Get deliveries
        const query = `
            SELECT id, email, status, error, created_at
            FROM request_deliveries
            ${whereClause}
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
        `;
        const result = await pool.query(query, queryParams);
        
        // Build table HTML
        let tableHTML = '';
        if (result.rows.length === 0) {
            tableHTML = '<div class="empty">No deliveries found</div>';
        } else {
            tableHTML = `
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Email</th>
                            <th>Status</th>
                            <th>Error</th>
                            <th>Created</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${result.rows.map(row => `
                            <tr>
                                <td>${row.id}</td>
                                <td>${row.email}</td>
                                <td>
                                    <span class="badge ${row.status === 'sent' ? 'badge-success' : 'badge-danger'}">
                                        ${row.status}
                                    </span>
                                </td>
                                <td>${truncateText(row.error || '', 80)}</td>
                                <td>${formatDate(row.created_at)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }
        
        // Build filter form
        const urlParams = { limit };
        if (statusFilter) urlParams.status = statusFilter;
        
        const content = `
            <h1>Request Deliveries</h1>
            <p class="breadcrumb"><a href="${ADMIN_PATH}">Dashboard</a> / Deliveries</p>
            
            <div class="filters">
                <form method="get" style="display: inline-block;">
                    <label>Status:</label>
                    <select name="status" onchange="this.form.submit()">
                        <option value="">All</option>
                        <option value="sent" ${statusFilter === 'sent' ? 'selected' : ''}>Sent</option>
                        <option value="failed" ${statusFilter === 'failed' ? 'selected' : ''}>Failed</option>
                    </select>
                    <input type="hidden" name="limit" value="${limit}">
                </form>
                <a href="${ADMIN_PATH}/api/deliveries.csv${statusFilter ? '?status=' + statusFilter : ''}">Download CSV</a>
            </div>
            
            ${tableHTML}
            
            ${paginationHTML(page, totalPages, `${ADMIN_PATH}/deliveries`, urlParams)}
        `;
        
        res.send(adminLayout('Deliveries', content));
        
    } catch (err) {
        console.error('[Admin] Deliveries error:', err.message);
        res.status(500).send('Internal server error');
    }
});

// GET /admin/api/subscribers.csv - Export subscribers as CSV
app.get(`${ADMIN_PATH}/api/subscribers.csv`, basicAuth, async (req, res) => {
    try {
        if (!pool) {
            return res.status(503).send('Database not configured');
        }
        
        const statusFilter = req.query.status;
        
        let whereClause = '';
        let queryParams = [];
        
        if (statusFilter === 'subscribed' || statusFilter === 'unsubscribed') {
            whereClause = 'WHERE status = $1';
            queryParams.push(statusFilter);
        }
        
        const query = `
            SELECT email, status, source, created_at, unsubscribed_at
            FROM newsletter_subscribers
            ${whereClause}
            ORDER BY created_at DESC
        `;
        
        const result = await pool.query(query, queryParams);
        
        // Build CSV
        const header = 'email,status,source,created_at,unsubscribed_at\n';
        const rows = result.rows.map(row => {
            const email = `"${(row.email || '').replace(/"/g, '""')}"`;
            const status = row.status || '';
            const source = `"${(row.source || '').replace(/"/g, '""')}"`;
            const created = row.created_at ? new Date(row.created_at).toISOString() : '';
            const unsubscribed = row.unsubscribed_at ? new Date(row.unsubscribed_at).toISOString() : '';
            return `${email},${status},${source},${created},${unsubscribed}`;
        }).join('\n');
        
        const csv = header + rows;
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="subscribers.csv"');
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        res.send(csv);
        
    } catch (err) {
        console.error('[Admin] CSV export error:', err.message);
        res.status(500).send('Export failed');
    }
});

// GET /admin/api/deliveries.csv - Export deliveries as CSV
app.get(`${ADMIN_PATH}/api/deliveries.csv`, basicAuth, async (req, res) => {
    try {
        if (!pool) {
            return res.status(503).send('Database not configured');
        }
        
        const statusFilter = req.query.status;
        
        let whereClause = '';
        let queryParams = [];
        
        if (statusFilter === 'sent' || statusFilter === 'failed') {
            whereClause = 'WHERE status = $1';
            queryParams.push(statusFilter);
        }
        
        const query = `
            SELECT id, email, status, error, created_at
            FROM request_deliveries
            ${whereClause}
            ORDER BY created_at DESC
        `;
        
        const result = await pool.query(query, queryParams);
        
        // Build CSV
        const header = 'id,email,status,error,created_at\n';
        const rows = result.rows.map(row => {
            const id = row.id || '';
            const email = `"${(row.email || '').replace(/"/g, '""')}"`;
            const status = row.status || '';
            const error = `"${(row.error || '').replace(/"/g, '""')}"`;
            const created = row.created_at ? new Date(row.created_at).toISOString() : '';
            return `${id},${email},${status},${error},${created}`;
        }).join('\n');
        
        const csv = header + rows;
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="deliveries.csv"');
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        res.send(csv);
        
    } catch (err) {
        console.error('[Admin] CSV export error:', err.message);
        res.status(500).send('Export failed');
    }
});

// ============================================================
// FUNNEL TRACKING
// ============================================================

// Track page view
app.post('/api/track', async (req, res) => {
    try {
        if (!pool) {
            return res.status(200).json({ ok: true });
        }

        const { page, session_id, referrer } = req.body;

        if (!page || typeof page !== 'string') {
            return res.status(200).json({ ok: true });
        }

        const validPages = ['index', 'booking', 'context', 'preview', 'payment', 'results'];
        if (!validPages.includes(page)) {
            return res.status(200).json({ ok: true });
        }

        await pool.query(
            'INSERT INTO page_views (page, session_id, referrer) VALUES ($1, $2, $3)',
            [page, session_id || null, referrer || null]
        );

        res.json({ ok: true });
    } catch (err) {
        console.error('[Track] Error:', err.message);
        res.status(200).json({ ok: true });
    }
});

// Hourly funnel report (called by cron)
app.get('/api/cron/hourly-report', async (req, res) => {
    try {
        const cronSecret = req.query.secret || req.headers['x-cron-secret'];
        if (cronSecret !== process.env.CRON_SECRET && process.env.CRON_SECRET) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (!pool) {
            return res.status(500).json({ error: 'Database not configured' });
        }

        if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
            return res.status(500).json({ error: 'SendGrid not configured' });
        }

        const result = await pool.query(`
            SELECT page, COUNT(*) as count
            FROM page_views
            WHERE created_at > NOW() - INTERVAL '1 hour'
            GROUP BY page
            ORDER BY
                CASE page
                    WHEN 'index' THEN 1
                    WHEN 'booking' THEN 2
                    WHEN 'context' THEN 3
                    WHEN 'preview' THEN 4
                    WHEN 'payment' THEN 5
                    WHEN 'results' THEN 6
                END
        `);

        const pageViews = {};
        result.rows.forEach(row => {
            pageViews[row.page] = parseInt(row.count);
        });

        const funnel = {
            index: pageViews.index || 0,
            booking: pageViews.booking || 0,
            context: pageViews.context || 0,
            preview: pageViews.preview || 0,
            payment: pageViews.payment || 0,
            results: pageViews.results || 0
        };

        const dropoffs = {
            'index → booking': funnel.index - funnel.booking,
            'booking → context': funnel.booking - funnel.context,
            'context → preview': funnel.context - funnel.preview,
            'preview → payment': funnel.preview - funnel.payment,
            'payment → results': funnel.payment - funnel.results
        };

        let biggestDrop = { step: 'none', count: 0 };
        for (const [step, count] of Object.entries(dropoffs)) {
            if (count > biggestDrop.count) {
                biggestDrop = { step, count };
            }
        }

        const now = new Date();
        const emailText = `StayHustler Hourly Funnel Report
${now.toISOString()}

FUNNEL OVERVIEW (Last Hour)
═══════════════════════════════════════

Homepage visits:     ${funnel.index}
Started booking:     ${funnel.booking} ${funnel.index > 0 ? `(${Math.round(funnel.booking/funnel.index*100)}%)` : ''}
Completed context:   ${funnel.context} ${funnel.booking > 0 ? `(${Math.round(funnel.context/funnel.booking*100)}%)` : ''}
Saw preview:         ${funnel.preview} ${funnel.context > 0 ? `(${Math.round(funnel.preview/funnel.context*100)}%)` : ''}
Reached payment:     ${funnel.payment} ${funnel.preview > 0 ? `(${Math.round(funnel.payment/funnel.preview*100)}%)` : ''}
Completed (results): ${funnel.results} ${funnel.payment > 0 ? `(${Math.round(funnel.results/funnel.payment*100)}%)` : ''}

DROP-OFF ANALYSIS
═══════════════════════════════════════

${Object.entries(dropoffs).map(([step, count]) => `${step}: ${count} dropped`).join('\n')}

Biggest drop-off: ${biggestDrop.step} (${biggestDrop.count} visitors)

CONVERSION
═══════════════════════════════════════

Overall: ${funnel.index > 0 ? `${Math.round(funnel.results/funnel.index*100)}%` : 'N/A'} (${funnel.results}/${funnel.index})

—
StayHustler Analytics
`;

        const msg = {
            to: 'rlajoux@gmail.com',
            from: process.env.SENDGRID_FROM_EMAIL,
            subject: `StayHustler Hourly: ${funnel.index} visits, ${funnel.results} conversions`,
            text: emailText
        };

        await sgMail.send(msg);
        console.log('[Cron] Hourly report sent');

        res.json({ ok: true, funnel, dropoffs });

    } catch (err) {
        console.error('[Cron] Hourly report error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Health check endpoints (both /health and /api/health)
app.get('/health', (req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Start server - bind to 0.0.0.0 for Railway
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log(`API endpoint: http://0.0.0.0:${PORT}/api/generate-request`);

    // Automatic hourly funnel report
    if (process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL && pool) {
        console.log('[Cron] Hourly funnel report scheduler started');

        // Run every hour
        setInterval(async () => {
            try {
                console.log('[Cron] Running hourly funnel report...');

                const result = await pool.query(`
                    SELECT page, COUNT(*) as count
                    FROM page_views
                    WHERE created_at > NOW() - INTERVAL '1 hour'
                    GROUP BY page
                `);

                const pageViews = {};
                result.rows.forEach(row => {
                    pageViews[row.page] = parseInt(row.count);
                });

                const funnel = {
                    index: pageViews.index || 0,
                    booking: pageViews.booking || 0,
                    context: pageViews.context || 0,
                    preview: pageViews.preview || 0,
                    payment: pageViews.payment || 0,
                    results: pageViews.results || 0
                };

                const dropoffs = {
                    'index → booking': funnel.index - funnel.booking,
                    'booking → context': funnel.booking - funnel.context,
                    'context → preview': funnel.context - funnel.preview,
                    'preview → payment': funnel.preview - funnel.payment,
                    'payment → results': funnel.payment - funnel.results
                };

                let biggestDrop = { step: 'none', count: 0 };
                for (const [step, count] of Object.entries(dropoffs)) {
                    if (count > biggestDrop.count) {
                        biggestDrop = { step, count };
                    }
                }

                const now = new Date();
                const emailText = `StayHustler Hourly Funnel Report
${now.toISOString()}

FUNNEL OVERVIEW (Last Hour)
═══════════════════════════════════════

Homepage visits:     ${funnel.index}
Started booking:     ${funnel.booking} ${funnel.index > 0 ? `(${Math.round(funnel.booking/funnel.index*100)}%)` : ''}
Completed context:   ${funnel.context} ${funnel.booking > 0 ? `(${Math.round(funnel.context/funnel.booking*100)}%)` : ''}
Saw preview:         ${funnel.preview} ${funnel.context > 0 ? `(${Math.round(funnel.preview/funnel.context*100)}%)` : ''}
Reached payment:     ${funnel.payment} ${funnel.preview > 0 ? `(${Math.round(funnel.payment/funnel.preview*100)}%)` : ''}
Completed (results): ${funnel.results} ${funnel.payment > 0 ? `(${Math.round(funnel.results/funnel.payment*100)}%)` : ''}

DROP-OFF ANALYSIS
═══════════════════════════════════════

${Object.entries(dropoffs).map(([step, count]) => `${step}: ${count} dropped`).join('\n')}

Biggest drop-off: ${biggestDrop.step} (${biggestDrop.count} visitors)

CONVERSION
═══════════════════════════════════════

Overall: ${funnel.index > 0 ? `${Math.round(funnel.results/funnel.index*100)}%` : 'N/A'} (${funnel.results}/${funnel.index})

—
StayHustler Analytics
`;

                await sgMail.send({
                    to: 'rlajoux@gmail.com',
                    from: process.env.SENDGRID_FROM_EMAIL,
                    subject: `StayHustler Hourly: ${funnel.index} visits, ${funnel.results} conversions`,
                    text: emailText
                });

                console.log('[Cron] Hourly report sent successfully');
            } catch (err) {
                console.error('[Cron] Hourly report error:', err.message);
            }
        }, 60 * 60 * 1000); // Every hour (60 min * 60 sec * 1000 ms)
    }
});
