const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRequest, sanitizeInput } = require('../validation');
const booking = { hotel: 'โรงแรม Audit', city: 'Bangkok', checkin: '2026-10-13', checkout: '2026-10-15', channel: 'direct' };
const context = { requestType: 'late_checkout', arrivalDay: 'tuesday', lengthOfStay: '2', askPreference: 'email', flexibility_primary: 'timing', flexibility_detail: '4pm checkout' };

test('preserves the paid request type and flexibility detail', () => {
    const clean = sanitizeInput({ booking, context });
    assert.equal(clean.context.requestType, 'late_checkout');
    assert.equal(clean.context.flexibility_detail, '4pm checkout');
    assert.equal(clean.booking.hotel, booking.hotel);
});
test('rejects checkout before arrival at the server boundary', () => {
    assert(validateRequest({ booking: { ...booking, checkout: '2026-10-12' }, context }).length > 0);
});
test('rejects malformed scalar inputs and unsupported request types', () => {
    assert(validateRequest({ booking: { ...booking, hotel: {} }, context }).length > 0);
    assert(validateRequest({ booking, context: { ...context, requestType: 'unrecognised' } }).length > 0);
});
