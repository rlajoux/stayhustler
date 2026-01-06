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
    
    return `You are an expert in hotel guest relations. Generate a polite, professional hotel upgrade/perk request.

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

REQUIREMENTS:
1. Generate a professional, calm, polite email requesting an upgrade or perks
2. Never sound entitled or demanding
3. Acknowledge that upgrades depend on availability
4. Do NOT use words: "hack", "trick", "free", "guarantee"
5. Do NOT mention "AI", "Gemini", or "StayHustler"
6. Do NOT claim to contact the hotel on behalf of the guest
7. Include [Your Name] placeholder at the end of the email
8. If an occasion is mentioned (birthday, anniversary, etc.), reference it appropriately
9. If loyalty status is Gold or Silver, mention membership subtly
10. Be specific about what's being requested but remain flexible

OUTPUT FORMAT (respond with valid JSON only, no markdown):
{
  "email_subject": "Brief, professional subject line",
  "email_body": "The full email text with proper greeting and closing. Use [Your Name] for signature.",
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
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
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

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`API endpoint: http://localhost:${PORT}/api/generate-request`);
});
