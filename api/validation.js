const REQUEST_TYPES = ['upgrade', 'late_checkout', 'breakfast_lounge', 'better_view', 'credit_spa_fb', 'any_upgrade'];
const EMAIL_REGEX = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** @param {unknown} value */
function isDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

/** Validate the customer boundary before persisting or generating anything. */
function validateRequest(body) {
    const errors = [];
    if (!body || typeof body !== 'object') return ['Request must be an object'];
    for (const section of ['booking', 'context']) {
        if (!body[section] || typeof body[section] !== 'object' || Array.isArray(body[section])) errors.push(`${section} must be an object`);
    }
    if (errors.length) return errors;
    for (const name of ['hotel', 'city']) {
        if (typeof body.booking[name] !== 'string' || !body.booking[name].trim() || body.booking[name].length > 200) errors.push(`booking.${name} must contain 1–200 characters`);
    }
    for (const name of ['checkin', 'checkout']) {
        if (!isDate(body.booking[name])) errors.push(`booking.${name} must be a valid date`);
    }
    if (isDate(body.booking.checkin) && isDate(body.booking.checkout)) {
        const nights = (Date.parse(body.booking.checkout) - Date.parse(body.booking.checkin)) / 86400000;
        if (nights < 1 || nights > 365) errors.push('Check-out must be after check-in, within 365 nights');
    }
    const enums = [
        [body.booking, 'channel', ['direct', 'ota', 'corporate']],
        [body.booking, 'hotel_type', ['unknown', 'chain', 'independent']],
        [body.context, 'requestType', REQUEST_TYPES],
        [body.context, 'askPreference', ['email', 'inperson', 'in-person', 'both']],
        [body.context, 'arrivalDay', DAYS],
        [body.context, 'flexibility_primary', ['any', 'category', 'view', 'timing', 'none']],
        [body.context, 'checkinTime', ['morning', 'afternoon', 'evening']]
    ];
    for (const [object, name, allowed] of enums) {
        if (object[name] !== undefined && object[name] !== '' && !allowed.includes(object[name])) errors.push(`Unsupported ${name}`);
    }
    for (const [object, names] of [[body.booking, ['room']], [body.context, ['lengthOfStay', 'loyaltyStatus', 'loyalty', 'occasion', 'flexibility', 'flexibility_detail', 'preferredRoom', 'preferredRoomType', 'checkinTimePref']]]) {
        for (const name of names) {
            if (object[name] !== undefined && (typeof object[name] !== 'string' || object[name].length > 200)) errors.push(`${name} must be text of at most 200 characters`);
        }
    }
    return errors;
}

function sanitizeInput(body) {
    const errors = validateRequest(body);
    if (errors.length) throw Object.assign(new Error(errors.join('; ')), { status: 400 });
    const text = value => typeof value === 'string' ? value.trim() : '';
    const { booking, context } = body;
    return {
        booking: { hotel: text(booking.hotel), city: text(booking.city), checkin: booking.checkin, checkout: booking.checkout, room: text(booking.room), channel: booking.channel || 'direct', hotel_type: booking.hotel_type || 'unknown' },
        context: {
            requestType: context.requestType || 'upgrade',
            lengthOfStay: String((Date.parse(booking.checkout) - Date.parse(booking.checkin)) / 86400000),
            arrivalDay: DAYS[new Date(booking.checkin).getUTCDay()],
            checkinTimePref: text(context.checkinTime || context.checkinTimePref),
            loyalty: text(context.loyaltyStatus || context.loyalty) || 'none', occasion: text(context.occasion) || 'none',
            flexibility: text(context.flexibility) || 'any',
            flexibility_primary: text(context.flexibility_primary) || (['any', 'category', 'view', 'timing', 'none'].includes(context.flexibility) ? context.flexibility : 'any'),
            flexibility_detail: text(context.flexibility_detail), preferredRoomType: text(context.preferredRoom || context.preferredRoomType),
            askPreference: context.askPreference || 'both'
        }
    };
}

function cleanEmail(value) {
    if (typeof value !== 'string' || value.length > 254 || !EMAIL_REGEX.test(value.trim())) throw Object.assign(new Error('A valid email address is required'), { status: 400 });
    return value.trim().toLowerCase();
}

module.exports = { validateRequest, sanitizeInput, cleanEmail, REQUEST_TYPES, EMAIL_REGEX };
