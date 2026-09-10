const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const loyalty = require('../assets/loyalty');
const { sanitizeInput, validateRequest } = require('../validation');
const { buildPrompt, generateRequestPayload } = require('../generation');
const booking = { hotel: 'Audit Hotel', city: 'Bangkok', checkin: '2026-10-13', checkout: '2026-10-15', channel: 'direct' };
const selection = (programme, tier, confirmed = true) => ({ requestType: 'late_checkout', loyaltyProgramme: programme, loyaltyTier: tier, loyaltyHotelConfirmed: confirmed });
const advice = (programme, tier, channel = 'direct') => loyalty.describe(selection(programme, tier), { ...booking, channel });

test('legacy drafts retain their exact sanitised bytes for pending checkout retries', () => {
    const data = sanitizeInput({ booking, context: { requestType: 'late_checkout', loyaltyStatus: 'gold' } });
    // Captured from the pre-loyalty implementation; order idempotency hashes this JSON.
    assert.equal(crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex'), '9239b2c674fb1a9f7b3981331f6aff69eadf7f5c9c133608350b8af2e56dacf0');
    assert.deepEqual(sanitizeInput(data), data);
});

test('all ten programmes and their tiers survive order sanitisation and generation sanitisation', () => {
    assert.equal(loyalty.programmes.length, 10);
    for (const programme of loyalty.programmes) {
        for (const tier of programme.tiers) {
            const data = sanitizeInput({ booking, context: selection(programme.id, tier.id) });
            assert.deepEqual(sanitizeInput(data), data);
            assert.equal(data.context.loyaltyProgramme, programme.id);
            assert.equal(data.context.loyaltyTier, tier.id);
            assert.equal(data.context.loyaltyRulesVersion, '2026-09-10');
            assert.equal(loyalty.describe(data.context, data.booking).benefits.length, 5);
        }
    }
});

test('server rejects mismatched programmes, malformed fields and unsupported tiers', () => {
    for (const context of [selection('marriott', 'globalist'), selection('gha', 'diamond'), selection('none', 'gold'), selection('unknown_programme', 'gold'), selection('hilton', ''), selection('hilton', 'gold', 'true'), selection(['hilton'], 'gold'), selection('hilton', { id: 'gold' }), selection(null, '')]) {
        assert(validateRequest({ booking, context }).length > 0, JSON.stringify(context));
        assert.throws(() => sanitizeInput({ booking, context }), { status: 400 });
    }
    for (const context of [{}, selection('none', '', false), selection('other', '', false), selection('unknown', '', false), selection('hilton', 'unknown', false)]) {
        assert.deepEqual(validateRequest({ booking, context }), []);
    }
});

test('programme-specific benefits do not collapse different Gold tiers or invent guaranteed checkout', () => {
    assert.equal(advice('gha', 'gold').requestBenefits.checkout.status, 'Not verified');
    assert.match(advice('marriott', 'gold').requestBenefits.checkout.detail, /2 pm/);
    assert.match(advice('hilton', 'gold').requestBenefits.checkout.detail, /no fixed/);
    assert.match(advice('gha', 'platinum').requestBenefits.checkout.detail, /3 pm/);
    assert.equal(advice('gha', 'platinum').requestBenefits.checkout.status, 'Subject to availability');
    assert.match(advice('hilton', 'diamond_reserve').requestBenefits.checkout.detail, /Small Luxury Hotels.*subject to availability/);
    assert.match(advice('accor', 'gold').requestBenefits.arrival.detail, / OR /);
    assert.match(advice('accor', 'platinum').requestBenefits.arrival.detail, / AND /);
    assert.match(advice('radisson', 'vip').note, /Americas.*Choice/);
    assert.match(advice('choice', 'titanium').requestBenefits.breakfast.detail, /Americas/);
});

test('OTA and unconfirmed participation never become assumed booking entitlements', () => {
    const excluded = advice('gha', 'platinum', 'ota');
    assert.deepEqual(excluded.requestBenefits, {});
    assert.match(excluded.eligibility, /generally do not apply/);
    const radisson = advice('radisson', 'premium', 'ota');
    assert.match(radisson.requestBenefits.checkout.detail, /two hours/);
    assert.match(radisson.eligibility, /permits benefits/);
    assert.match(advice('choice', 'gold', 'ota').eligibility, /differs by benefit/);
    const unconfirmed = loyalty.describe(selection('gha', 'platinum', false), booking);
    assert.equal(unconfirmed.includeStatus, false);
    assert.deepEqual(unconfirmed.requestBenefits, {});
    assert.equal(loyalty.describe(selection('hilton', 'unknown', false), booking).includeStatus, false);
});

test('generation uses server rules, preserves conditions and ignores client-supplied benefit claims', () => {
    const context = { ...selection('gha', 'platinum'), loyalty: 'Hilton Diamond', loyaltyStatus: 'Diamond', loyaltyBenefits: 'Guaranteed presidential suite', loyaltyRulesVersion: 'attacker-version' };
    const data = sanitizeInput({ booking, context });
    assert.equal(data.context.loyalty, 'GHA DISCOVERY Platinum');
    const prompt = buildPrompt(data);
    assert(prompt.includes('GHA DISCOVERY Platinum'));
    assert(prompt.includes('Until 3 pm'));
    assert(prompt.includes('Subject to availability'));
    assert(!prompt.includes('Guaranteed presidential suite'));
    assert(!prompt.includes('Hilton Diamond'));
    assert(!prompt.includes('attacker-version'));
    assert(!prompt.includes('One room category.')); // Late checkout is the chosen request.
    assert(buildPrompt(sanitizeInput({ booking: { ...booking, channel: 'ota' }, context })).includes('"benefits":{}'));
    assert(buildPrompt(sanitizeInput({ booking, context: selection('gha', 'platinum', false) })).includes('Do not mention a loyalty programme'));
    assert(buildPrompt(sanitizeInput({ booking, context: { loyaltyStatus: 'gold' } })).includes('Generic legacy loyalty labels'));
});

test('missing selected status triggers a retry, then the paid request includes the exact programme and tier', async () => {
    const result = { email_subject: 'Late checkout on 2026-10-15', email_body: 'Hello Audit Hotel, Reservation: [Confirmation Number]. My stay is 2026-10-13 to 2026-10-15. May I request late checkout? [Your Name]', timing_guidance: ['Ask at arrival.', 'Confirm availability.', 'Respect hotel policy.'], fallback_script: 'May I request late checkout?' };
    let attempts = 0;
    const generated = await generateRequestPayload(booking, selection('gha', 'platinum'), { apiKey: 'test', fetch: async (url, options) => {
        attempts++;
        assert(JSON.parse(options.body).contents[0].parts[0].text.includes('GHA DISCOVERY Platinum'));
        const output = attempts === 1 ? result : { ...result, email_body: result.email_body.replace('May I', 'As a GHA DISCOVERY Platinum member, may I'), fallback_script: 'As a GHA DISCOVERY Platinum member, may I request late checkout subject to availability?' };
        return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(output) }] } }] }) };
    } });
    assert.equal(attempts, 2);
    assert.equal(generated.finalSource, 'second');
    assert(generated.result.email_body.includes('GHA DISCOVERY Platinum'));
    assert(generated.result.fallback_script.includes('GHA DISCOVERY Platinum'));
});
