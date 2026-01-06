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
    
    return `You are an expert in hotel guest relations. Generate a polite, professional, and SPECIFIC hotel upgrade/perk request email.

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

STRICT EMAIL REQUIREMENTS:
1. Length: The email_body MUST be 140-220 words. Not shorter, not longer.

2. Specificity: The email MUST reference at least TWO of the following details from the input (if available):
   - Arrival day or check-in date
   - Length of stay
   - Booking channel
   - Loyalty status (if any)
   - Occasion (if any)
   - Flexibility preferences (room type or timing)

3. The Ask: Include ONE specific-but-flexible upgrade request. Either:
   - Name a higher category (e.g., "a Junior Suite or Club-level room"), OR
   - Use "any higher-category room or suite that might remain available"

4. Operational Courtesy: Include ONE signal that shows hotel-operations awareness:
   - E.g., "I'm flexible on room type and timing" or "I understand availability and demand drive these decisions"

5. Soft Close: End with acknowledgment that they're happy to keep their existing booking if an upgrade isn't possible.

6. Tone: Warm, gracious, never entitled or pressuring. Read like a seasoned traveler, not someone gaming the system.

BANNED PHRASES (never use these words):
"free", "guarantee", "hack", "trick", "owed", "must", "demand", "entitled", "deserve"

ADDITIONAL RULES:
- Do NOT mention "AI", "Gemini", or "StayHustler"
- Do NOT claim to contact the hotel on behalf of the guest
- Use [Your Name] as the signature placeholder
- If an occasion is mentioned (birthday, anniversary, honeymoon), weave it in naturally
- If loyalty status exists, mention membership subtly (not as leverage)

GOLD STANDARD EXAMPLE (emulate this tone and structure, do NOT copy verbatim):
---
Hello [Hotel Team],

I'm looking forward to my upcoming stay arriving Thursday for two nights. I booked a Deluxe King and wanted to share a quick note ahead of arrival.

If any higher-category rooms are forecasted to remain available around check-in, I'd be grateful to be considered. I'm flexible on room type and timing and completely understand that availability and demand come first.

This is my first stay with you and I'm excited to experience the property. If it's not possible, I'm of course happy to keep my existing reservation.

Warm regards,
[Your Name]
---

OUTPUT FORMAT (respond with STRICT JSON only, no markdown, no code blocks, no commentary):
{
  "email_subject": "Brief, professional subject line (not generic)",
  "email_body": "The full email text (140-220 words) with proper greeting and closing. Use [Your Name] for signature.",
  "timing_guidance": ["First timing tip", "Second timing tip", "Third timing tip"],
  "fallback_script": "A brief, polite script (1-2 sentences) for asking at the front desk in person"
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
        
        // Call Gemini
        const result = await callGemini(prompt);
        
        // Validate response structure
        if (!result.email_subject || !result.email_body || !result.timing_guidance || !result.fallback_script) {
            throw new Error('Incomplete response from AI');
        }
        
        // Ensure timing_guidance is an array
        if (!Array.isArray(result.timing_guidance)) {
            result.timing_guidance = [result.timing_guidance];
        }
        
        res.json(result);
        
    } catch (error) {
        console.error('Error generating request:', error.message);
        
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
