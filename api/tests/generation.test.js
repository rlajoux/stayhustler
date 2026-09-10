const test = require('node:test');
const assert = require('node:assert/strict');
const { generateRequestPayload, validateOutput, buildPrompt, MODEL } = require('../generation');
const { sanitizeInput, REQUEST_TYPES } = require('../validation');
const booking = { hotel: 'Audit Hotel', city: 'Bangkok', checkin: '2026-10-13', checkout: '2026-10-15' };
const result = { email_subject: 'Request for 13 October', email_body: 'Hello,\nReservation: [Confirmation Number]\nMy stay at Audit Hotel is from 2026-10-13 to 2026-10-15. Could you consider a room upgrade? Thank you, [Your Name]', timing_guidance: ['Ask in advance.', 'Confirm with reception.', 'Respect hotel policy.'], fallback_script: 'Could you consider a room upgrade?' };

test('every request type and preference reaches the model prompt', () => {
    for (const requestType of REQUEST_TYPES) {
        const prompt = buildPrompt(sanitizeInput({ booking, context: { requestType, flexibility_detail: '4pm checkout' } }));
        assert(prompt.includes(`selected request is ${requestType}:`));
        assert(prompt.includes('4pm checkout'));
    }
    assert.notEqual(MODEL, 'gemini-2.0-flash');
});
test('structured generation uses the supported JSON schema and header authentication', async () => {
    const generated = await generateRequestPayload(booking, { requestType: 'upgrade' }, { apiKey: 'test-key', fetch: async (url, options) => {
        assert(!url.includes('test-key'));
        assert.equal(options.headers['x-goog-api-key'], 'test-key');
        assert(JSON.parse(options.body).generationConfig.responseJsonSchema);
        assert(options.signal instanceof AbortSignal);
        return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(result) }] } }] }) };
    } });
    assert.deepEqual(generated.result, result);
});
test('invalid model output, truncation and provider errors cannot become successful templates', async () => {
    assert.equal(validateOutput({ ...result, timing_guidance: ['<img src=x onerror=alert(1)>','two','three'] }).ok, false);
    for (const fake of [
        { ok: false, status: 404 },
        { ok: true, json: async () => ({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: JSON.stringify(result) }] } }] }) },
        { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{invalid' }] } }] }) }
    ]) await assert.rejects(generateRequestPayload(booking, {}, { apiKey: 'test', fetch: async () => fake }), { code: 'generation_unavailable' });
});
test('hung model requests are aborted and retried only once', async () => {
    let attempts = 0;
    const hold = setTimeout(() => {}, 1000);
    try {
        await assert.rejects(generateRequestPayload(booking, {}, { apiKey: 'test', timeoutMs: 10, fetch: (url, { signal }) => new Promise((resolve, reject) => {
            attempts++; signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }) }), { code: 'generation_unavailable' });
        assert.equal(attempts, 2);
    } finally { clearTimeout(hold); }
});

test('request-specific output validation rejects a different benefit and missing booking facts', () => {
    const requests = { upgrade: 'a room upgrade', late_checkout: 'late checkout', breakfast_lounge: 'breakfast access', better_view: 'a quieter location within my booked category', credit_spa_fb: 'a dining credit', any_upgrade: 'any available enhancement' };
    for (const [requestType, wording] of Object.entries(requests)) {
        const data = sanitizeInput({ booking, context: { requestType } });
        const matching = { ...result, email_body: `Hello Audit Hotel, my stay is 2026-10-13 to 2026-10-15. Reservation: [Confirmation Number]. Could I ask for ${wording}? [Your Name]`, fallback_script: `Could I ask for ${wording}?` };
        assert.equal(validateOutput(matching, data).ok, true, requestType);
        assert.equal(validateOutput({ ...matching, email_body: 'Missing all booking details' }, data).ok, false);
        if (requestType === 'late_checkout' || requestType === 'better_view') assert.equal(validateOutput(result, data).ok, false);
    }
});
