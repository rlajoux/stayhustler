(() => {
    const requestType = new URLSearchParams(location.search).get('request');
    const allowed = ['upgrade', 'late_checkout', 'breakfast_lounge', 'better_view', 'credit_spa_fb', 'any_upgrade'];
    if (!allowed.includes(requestType)) return;
    try {
        localStorage.setItem('stayhustler_context', JSON.stringify({ ...StayHustler.read('context'), requestType }));
    } catch { /* The booking form reports blocked storage when submitted. */ }
})();
