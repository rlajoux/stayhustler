const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

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
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) return callback(null, true);
        
        // If ALLOWED_ORIGIN is set, use only that
        if (process.env.ALLOWED_ORIGIN) {
            if (origin === process.env.ALLOWED_ORIGIN) {
                return callback(null, true);
            }
            return callback(new Error('Not allowed by CORS'));
        }
        
        // Otherwise allow all origins for now
        callback(null, true);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
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
        console.log('[RateLimit] rate_limited', { ip, count: entry.count });
        return res.status(429).json({
            error: 'Rate limit exceeded. Please try again in a few minutes.'
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

// Resend rate limiter (stricter: 3 per 10 minutes)
const RESEND_LIMIT_MAX = 3;
const resendLimitStore = new Map();

function resendRateLimit(req, res, next) {
    const ip = getClientIp(req);
    const now = Date.now();
    
    let entry = resendLimitStore.get(ip);
    
    if (!entry) {
        entry = { count: 0, windowStart: now };
        resendLimitStore.set(ip, entry);
    }
    
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        entry.count = 0;
        entry.windowStart = now;
    }
    
    entry.count++;
    
    if (entry.count > RESEND_LIMIT_MAX) {
        console.log('[ResendRateLimit] rate_limited', { ip, count: entry.count });
        return res.status(429).json({
            error: 'Too many resend attempts. Please try again later.'
        });
    }
    
    next();
}

setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of resendLimitStore.entries()) {
        if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
            resendLimitStore.delete(ip);
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
- Flexibility on room type: ${context.flexibility}
- Preferred room type (if specific): ${context.preferredRoomType || 'N/A'}
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

3. The Ask: Make ONE clear, specific-but-flexible request:
   - Request consideration for "any higher-category room" (optionally add "including suites if appropriate")
   - Do NOT use vague language like "upgrade or perks"
   - Use the phrase "forecasted to remain available" exactly ONCE in the email

4. Specificity: Reference at least TWO of these details from input (if available):
   - Arrival day or check-in date
   - Length of stay
   - Booking channel
   - Loyalty status (if any)
   - Occasion (if any)
   - Flexibility preferences (room type or timing)

5. Flexibility Signal: If flexibility info is provided, mention it (e.g., "I'm flexible on room type and check-in timing").

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
  "email_body": "Full email text (160-210 words). Must include 'Reservation: [Confirmation Number]' near top and 'forecasted to remain available' exactly once. Use [Your Name] for signature.",
  "timing_guidance": ["First timing tip", "Second timing tip", "Third timing tip"],
  "fallback_script": "One sentence for asking at the front desk in person"
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

async function generateRequestPayload(booking, context) {
    const sanitizedData = sanitizeInput({ booking, context });
    const prompt = buildPrompt(sanitizedData);
    
    let firstPassValid = false;
    let secondPassAttempted = false;
    let finalSource = 'fallback';
    
    try {
        // First pass: Call Gemini
        const firstResult = await callGemini(prompt);
        
        // Validate first pass
        const firstValidation = validateOutput(firstResult);
        firstPassValid = firstValidation.ok;
        
        if (firstValidation.ok) {
            finalSource = 'first';
            console.log(`[Generation] hotel=${sanitizedData.booking.hotel} final_source=first`);
            return firstResult;
        }
        
        // First pass failed - attempt retry with correction prompt
        console.log(`[Generation] First pass failed: ${firstValidation.reasons.join('; ')}`);
        secondPassAttempted = true;
        
        const correctionPrompt = buildCorrectionPrompt(prompt, firstValidation.reasons);
        const secondResult = await callGemini(correctionPrompt);
        
        // Validate second pass
        const secondValidation = validateOutput(secondResult);
        
        if (secondValidation.ok) {
            finalSource = 'second';
            console.log(`[Generation] hotel=${sanitizedData.booking.hotel} final_source=second`);
            return secondResult;
        }
        
        // Second pass also failed - use fallback
        console.log(`[Generation] Second pass failed: ${secondValidation.reasons.join('; ')}`);
        finalSource = 'fallback';
        
    } catch (geminiError) {
        console.error(`[Generation] Gemini error: ${geminiError.message}`);
        finalSource = 'fallback';
    }
    
    // Return fallback payload
    console.log(`[Generation] hotel=${sanitizedData.booking.hotel} final_source=fallback`);
    return getFallbackPayload();
}

// API endpoint (rate limited)
app.post('/api/generate-request', rateLimit, async (req, res) => {
    try {
        // Validate request
        const errors = validateRequest(req.body);
        if (errors.length > 0) {
            return res.status(400).json({ 
                error: 'Validation failed', 
                details: errors 
            });
        }
        
        // Generate using reusable function
        const result = await generateRequestPayload(req.body.booking, req.body.context);
        return res.json(result);
        
    } catch (error) {
        console.error('Error in request handling:', error.message);
        
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
            const generated = await generateRequestPayload(booking, context);

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

            // Log to database and get the ID
            const insertResult = await pool.query(`
                INSERT INTO request_deliveries (email, booking, context, generated, status)
                VALUES ($1, $2, $3, $4, 'sent')
                RETURNING id
            `, [cleanEmail, JSON.stringify(booking), JSON.stringify(context), JSON.stringify(generated)]);

            const deliveryId = insertResult.rows[0].id;
            console.log(`[Delivery] Success for ${cleanEmail} hotel=${booking.hotel || 'unknown'} delivery_id=${deliveryId}`);
            res.json({ ok: true, delivery_id: deliveryId });

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

// POST /api/resend-delivery - Resend a previous delivery without regenerating
app.post('/api/resend-delivery', resendRateLimit, async (req, res) => {
    try {
        // Check if SendGrid is configured
        if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
            console.error('[Resend] SendGrid not configured');
            return res.status(502).json({ error: 'Resend failed.' });
        }

        // Check if DB is available
        if (!pool) {
            console.error('[Resend] Database not configured');
            return res.status(502).json({ error: 'Resend failed.' });
        }

        const { delivery_id, email } = req.body;

        // Validate delivery_id (basic check for integer)
        if (!delivery_id || !Number.isInteger(Number(delivery_id))) {
            return res.status(400).json({ error: 'Valid delivery_id is required.' });
        }

        // Load delivery from database
        console.log(`[Resend] Loading delivery ${delivery_id}`);
        const result = await pool.query(`
            SELECT id, email, booking, context, generated, status 
            FROM request_deliveries 
            WHERE id = $1
        `, [delivery_id]);

        if (result.rows.length === 0) {
            console.log(`[Resend] Delivery ${delivery_id} not found`);
            return res.status(404).json({ error: 'Delivery not found.' });
        }

        const delivery = result.rows[0];
        
        // Determine target email
        let targetEmail = delivery.email;
        if (email && typeof email === 'string' && EMAIL_REGEX.test(email)) {
            targetEmail = email.trim().toLowerCase();
        }

        // Parse the generated payload
        const generated = delivery.generated;
        const booking = delivery.booking;

        // Compose email (same format as deliver-request)
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

        // Send via SendGrid
        const msg = {
            to: targetEmail,
            from: process.env.SENDGRID_FROM_EMAIL,
            subject: 'Your StayHustler request is ready',
            text: emailText
        };

        await sgMail.send(msg);
        
        const maskedEmail = targetEmail.replace(/(.{2}).*(@.*)/, '$1***$2');
        console.log(`[Resend] Email sent to ${maskedEmail} delivery_id=${delivery_id}`);

        // Insert new audit row
        await pool.query(`
            INSERT INTO request_deliveries (email, booking, context, generated, status)
            VALUES ($1, $2, $3, $4, 'sent')
        `, [targetEmail, JSON.stringify(booking), JSON.stringify(delivery.context), JSON.stringify(generated)]);

        res.json({ ok: true });

    } catch (err) {
        console.error('[Resend] Error:', err.message);
        
        if (err.code === 403 || err.message.includes('Forbidden')) {
            console.error('[Resend] SendGrid forbidden - check sender verification');
        }
        
        res.status(502).json({ error: 'Resend failed.' });
    }
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
        const queryParams = { limit };
        if (statusFilter) queryParams.status = statusFilter;
        
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
            
            ${paginationHTML(page, totalPages, `${ADMIN_PATH}/subscribers`, queryParams)}
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
        const queryParams = { limit };
        if (statusFilter) queryParams.status = statusFilter;
        
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
            
            ${paginationHTML(page, totalPages, `${ADMIN_PATH}/deliveries`, queryParams)}
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
