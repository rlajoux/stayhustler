const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const crypto = require('crypto');
const Stripe = require('stripe');
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
    credentials: false
}));

app.use(express.json());

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
// B) email_body: 160-210 words, includes "Reservation: [Confirmation Number]",
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

    // B) email_body validation
    if (typeof output.email_body !== 'string') {
        reasons.push('email_body must be a string');
    } else {
        const bodyWords = wordCount(output.email_body);
        if (bodyWords < 160 || bodyWords > 210) {
            reasons.push(`email_body must be 160-210 words (got ${bodyWords})`);
        }
        if (!output.email_body.includes('Reservation: [Confirmation Number]')) {
            reasons.push('email_body must include exactly "Reservation: [Confirmation Number]"');
        }
        const forecastCount = countOccurrences(output.email_body, 'forecasted to remain available');
        if (forecastCount !== 1) {
            reasons.push(`email_body must include "forecasted to remain available" exactly once (got ${forecastCount})`);
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
                repaired.email_body = repaired.email_body.replace(
                    /If any (premium|upgraded|higher-category) rooms/i,
                    'If any $1 rooms are forecasted to remain available'
                );
                repairsMade.push('Inserted required phrase');
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
    
    // Repair C: Word count slightly outside range
    if (validationReasons.some(r => r.includes('email_body must be 160-210 words'))) {
        if (typeof repaired.email_body === 'string') {
            const bodyWords = wordCount(repaired.email_body);
            if (bodyWords < 160 && bodyWords >= 145) {
                // Too short by <15 words - add a polite closing sentence
                repaired.email_body += '\n\nI appreciate your time and consideration in reviewing this request.';
                repairsMade.push('Added padding sentence for word count');
            } else if (bodyWords > 210 && bodyWords <= 225) {
                // Too long by <15 words - trim excess sentences
                const sentences = repaired.email_body.split(/\.\s+/);
                if (sentences.length > 3) {
                    // Remove the second-to-last sentence (usually least critical)
                    sentences.splice(-2, 1);
                    repaired.email_body = sentences.join('. ');
                    repairsMade.push('Trimmed excess sentence for word count');
                }
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
    
    return { repaired, repairsMade };
}

// Build correction prompt for retry
function buildCorrectionPrompt(originalPrompt, reasons) {
    return `You previously returned output that violated these constraints:
${reasons.map(r => `- ${r}`).join('\n')}

Please generate a CORRECTED response that fixes ALL the above issues.

CRITICAL REQUIREMENTS:
- email_subject: 6-12 words, must include date (e.g., "Jan 15-18"), must NOT start with "Reservation Inquiry"
- email_body: 160-210 words, must include "Reservation: [Confirmation Number]" exactly, must include "forecasted to remain available" exactly once, no banned words (hack, trick, free, guarantee, owed, must, demand)
- timing_guidance: exactly 3 items, each 10-140 characters
- fallback_script: single sentence, 8-30 words, ends with . or ?

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
// - email_body: 160-210 words, includes "Reservation: [Confirmation Number]", "forecasted to remain available" once
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

// Build the prompt for Gemini
function buildPrompt(data) {
    const { booking, context } = data;
    
    // Handle new flexibility fields with backward compatibility
    const flexPrimary = context.flexibility_primary || context.flexibility || 'any';
    const flexDetail = context.flexibility_detail || '';
    
    return `You are an expert in hotel guest relations. Generate a polite, professional, and SPECIFIC hotel upgrade request email.

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
- Good examples to emulate (do not copy verbatim):
  "Upcoming stay Jan 15–18 — flexibility if available"
  "Arrival Jan 15–18 — request ahead of check-in"
  "Quick note ahead of Jan 15–18 stay"

===== EMAIL BODY RULES =====
1. Length: email_body MUST be 160–210 words. Not shorter, not longer.

2. Reservation Line: Near the top of the email (after greeting), include exactly:
   "Reservation: [Confirmation Number]"
   Keep this placeholder exactly as shown.

3. The Ask: CRITICAL - Adapt the request based on flexibility_priority:
   
   IF flexibility_priority = "any":
   - Ask for "any higher-category room" (optionally mention "including suites if appropriate")
   - State general flexibility on room type
   - Use the phrase "forecasted to remain available" exactly ONCE in the email
   
   IF flexibility_priority = "category":
   - Ask for higher-category room
   - If flexibility_detail is present, incorporate it as a preference (e.g., "particularly a junior suite")
   - Still include flexibility language (e.g., "open to similar categories if needed")
   - Use the phrase "forecasted to remain available" exactly ONCE in the email
   
   IF flexibility_priority = "view":
   - PRIMARY ask must be for "a better located room" - emphasize: higher floor, better view, quieter location, corner room, etc.
   - If flexibility_detail is present, incorporate it (e.g., "ocean view" or "high floor")
   - Do NOT focus on category upgrade; view/location is the priority
   - You MAY lightly mention "if a higher-category room is forecasted to remain available" but the main ask is view/location
   - Use the phrase "forecasted to remain available" exactly ONCE in the email
   
   IF flexibility_priority = "timing":
   - PRIMARY ask must be late checkout OR early check-in (default to late checkout unless detail suggests otherwise)
   - If flexibility_detail is present, use it (e.g., "late checkout around 2pm")
   - Do NOT push hard for category upgrade; timing enhancement is the main request
   - Keep tone: "If timing flexibility is possible..."
   - Use the phrase "forecasted to remain available" exactly ONCE (can apply to room inventory context)
   
   IF flexibility_priority = "none":
   - Do NOT ask for an upgrade
   - Ask only for a small, non-disruptive preference: quiet room, away from elevator, OR a timing perk if harmless
   - Tone: "If anything small is possible without disruption..."
   - Keep request minimal and gracious
   - Use the phrase "forecasted to remain available" exactly ONCE (in minimal context)

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

===== BANNED PHRASES =====
Never use: "free", "guarantee", "hack", "trick", "owed", "must", "demand", "entitled", "deserve", "upgrade or perks"

===== ADDITIONAL RULES =====
- Do NOT mention "AI", "Gemini", or "StayHustler"
- Do NOT claim to contact the hotel on behalf of the guest
- Use [Your Name] as the signature placeholder
- If an occasion is mentioned (birthday, anniversary, honeymoon), weave it in naturally
- If loyalty status exists, mention membership subtly (not as leverage)
- If flexibility_priority is not provided or unrecognized, treat it as "any"

===== GOLD STANDARD EXAMPLE (emulate tone and structure, do NOT copy verbatim) =====
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

===== OUTPUT FORMAT =====
Respond with STRICT JSON only. No markdown, no code blocks, no commentary.
{
  "email_subject": "6-12 word subject including dates (e.g., Jan 15–18), not starting with Reservation Inquiry",
  "email_body": "Full email text (160-210 words). Must include 'Reservation: [Confirmation Number]' near top and 'forecasted to remain available' exactly once. Use [Your Name] for signature. ADAPT THE ASK based on flexibility_priority.",
  "timing_guidance": ["First timing tip", "Second timing tip", "Third timing tip"],
  "fallback_script": "One sentence for asking at the front desk in person. ALIGN WITH flexibility_priority: any/category = mention upgraded rooms, view = mention room location/view, timing = mention late checkout/early check-in, none = mention quiet room placement"
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
        console.log(`[Generation:${rid}] Attempting repair step`);
        
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
                console.log(`[Generation:${rid}] ✗ Repair failed to fix all issues: ${repairedValidation.reasons.join('; ')}`);
            }
        } else {
            console.log(`[Generation:${rid}] No repairs could be applied`);
        }
        
        // All attempts failed - use fallback
        console.log(`[Generation:${rid}] Using fallback, first_pass_valid=${firstPassValid}, second_pass_attempted=${secondPassAttempted}`);
        finalSource = 'fallback';
        
    } catch (geminiError) {
        console.error(`[Generation:${rid}] Gemini error: ${geminiError.message}`);
        console.log(`[Generation:${rid}] Using fallback due to exception`);
        finalSource = 'fallback';
    }
    
    // Return fallback payload
    console.log(`[Generation:${rid}] Returning fallback, final_source=fallback`);
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
// Creates a test Checkout Session for $7.00 USD
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

        console.log('[Stripe] Creating test Checkout Session');

        // Create Checkout Session
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: 'StayHustler Test Request',
                        },
                        unit_amount: 700, // $7.00 in cents
                    },
                    quantity: 1,
                },
            ],
            success_url: `${process.env.PUBLIC_BASE_URL || 'https://stayhustler.com'}/stripe-success.html`,
            cancel_url: `${process.env.PUBLIC_BASE_URL || 'https://stayhustler.com'}/stripe-cancel.html`,
        });

        console.log('[Stripe] Checkout Session created:', session.id);

        return res.json({ 
            ok: true, 
            checkout_url: session.url 
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
});
