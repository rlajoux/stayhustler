(() => {
    const form = document.getElementById('start-form');
    const hotel = document.getElementById('start-hotel');
    const city = document.getElementById('start-city');
    const error = document.getElementById('start-error');
    const booking = StayHustler.read('booking');
    const context = StayHustler.read('context');
    const otherToggle = document.getElementById('other-request-toggle');
    const otherRequests = document.getElementById('other-requests');
    function showOtherRequests(show) {
        otherRequests.hidden = !show;
        otherToggle.setAttribute('aria-expanded', String(show));
    }
    otherToggle.addEventListener('click', () => showOtherRequests(otherRequests.hidden));
    hotel.value = typeof booking.hotel === 'string' ? booking.hotel : '';
    city.value = typeof booking.city === 'string' ? booking.city : '';
    for (const input of form.elements['request-type']) {
        if (input.value === context.requestType) input.checked = true;
    }
    showOtherRequests(!!otherRequests.querySelector('input:checked'));
    form.addEventListener('submit', event => {
        event.preventDefault();
        if (!hotel.value.trim() || !city.value.trim()) {
            error.textContent = 'Add your hotel name and city to get started.';
            error.classList.add('visible');
            (!hotel.value.trim() ? hotel : city).focus();
            return;
        }
        try {
            localStorage.setItem('stayhustler_booking', JSON.stringify({ ...booking, hotel: hotel.value.trim(), city: city.value.trim() }));
            const hotelChanged = hotel.value.trim() !== booking.hotel || city.value.trim() !== booking.city;
            localStorage.setItem('stayhustler_context', JSON.stringify({ ...context, requestType: form.elements['request-type'].value, ...(hotelChanged ? { loyaltyHotelConfirmed: false } : {}) }));
            location.href = '/booking';
        } catch {
            error.textContent = 'Your browser is blocking draft storage. Allow site storage to continue.';
            error.classList.add('visible');
        }
    });
})();

// Keep homepage funnel measurement alongside the other journey pages.
const trackHomepage = () => {
    fetch(StayHustler.apiBase + '/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: 'index', referrer: document.referrer })
    }).catch(() => {});
};
if (typeof requestIdleCallback === 'function') requestIdleCallback(trackHomepage);
else setTimeout(trackHomepage, 0);
