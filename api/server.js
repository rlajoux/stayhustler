const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

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
function containsBannedWords(s) {
    if (!s || typeof s !== 'string') return [];
    const lower = s.toLowerCase();
    return BANNED_WORDS.filter(word => {
        // Match whole word or as part of compound (avoid false positives)
        const regex = new RegExp(`\\b${word}\\b`, 'i');
        return regex.test(lower);
    });
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
        if (bodyBanned.length > 0) {
            reasons.push(`email_body contains banned words: ${bodyBanned.join(', ')}`);
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
        const newlineCount = (output.fallback_script.match(/\n/g) || []).length;
        if (newlineCount > 1) {
            reasons.push('fallback_script must be a single sentence (too many newlines)');
        }
        if (!/[.?]$/.test(output.fallback_script.trim())) {
            reasons.push('fallback_script must end with . or ?');
        }
        const scriptBanned = containsBannedWords(output.fallback_script);
        if (scriptBanned.length > 0) {
            reasons.push(`fallback_script contains banned words: ${scriptBanned.join(', ')}`);
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

// Deterministic fallback payload
function getFallbackPayload() {
    return {
        email_subject: "Upcoming stay — request ahead of arrival",
        email_body: `Hello [Hotel Team],

Reservation: [Confirmation Number]

I'm writing ahead of my upcoming stay to share a quick note. I'm very much looking forward to visiting your property and experiencing everything it has to offer.

If any higher-category rooms, including suites, are forecasted to remain available around my check-in time, I would be grateful to be considered for an upgrade. I'm flexible on room type and timing, and I completely understand that availability and operational needs come first.

This trip is a special occasion for me, and any additional touches to make the stay memorable would be wonderful, though certainly not expected. If an upgrade isn't possible, I'm of course happy to keep my existing reservation exactly as booked.

Thank you so much for any consideration. I truly appreciate your hospitality and look forward to arriving soon.

Warm regards,
[Your Name]`,
        timing_guidance: [
            "Send your email 24-48 hours before check-in for best results.",
            "Avoid sending requests on weekends when staffing may be limited.",
            "Follow up politely at the front desk if you haven't received a response."
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

// API endpoint
app.post('/api/generate-request', async (req, res) => {
    try {
        // Validate request
        const errors = validateRequest(req.body);
        if (errors.length > 0) {
            return res.status(400).json({ 
                error: 'Validation failed', 
                details: errors 
            });
        }
        
        // Sanitize input
        const sanitizedData = sanitizeInput(req.body);
        
        // Build prompt
        const prompt = buildPrompt(sanitizedData);
        
        // Quality enforcement logging
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
                console.log(`[QualityEnforcement] hotel=${sanitizedData.booking.hotel} first_pass_valid=true second_pass_attempted=false final_source=first`);
                return res.json(firstResult);
            }
            
            // First pass failed - attempt retry with correction prompt
            console.log(`[QualityEnforcement] First pass failed: ${firstValidation.reasons.join('; ')}`);
            secondPassAttempted = true;
            
            const correctionPrompt = buildCorrectionPrompt(prompt, firstValidation.reasons);
            const secondResult = await callGemini(correctionPrompt);
            
            // Validate second pass
            const secondValidation = validateOutput(secondResult);
            
            if (secondValidation.ok) {
                finalSource = 'second';
                console.log(`[QualityEnforcement] hotel=${sanitizedData.booking.hotel} first_pass_valid=false second_pass_attempted=true final_source=second`);
                return res.json(secondResult);
            }
            
            // Second pass also failed - use fallback
            console.log(`[QualityEnforcement] Second pass failed: ${secondValidation.reasons.join('; ')}`);
            finalSource = 'fallback';
            
        } catch (geminiError) {
            console.error(`[QualityEnforcement] Gemini error: ${geminiError.message}`);
            finalSource = 'fallback';
        }
        
        // Return fallback payload (always 200, never 5xx for content issues)
        console.log(`[QualityEnforcement] hotel=${sanitizedData.booking.hotel} first_pass_valid=${firstPassValid} second_pass_attempted=${secondPassAttempted} final_source=${finalSource}`);
        return res.json(getFallbackPayload());
        
    } catch (error) {
        console.error('Error in request handling:', error.message);
        
        // Only return 502 for actual server errors (not content quality issues)
        res.status(502).json({
            error: 'Failed to generate request',
            message: 'Unable to generate custom content at this time. Please try again.'
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
