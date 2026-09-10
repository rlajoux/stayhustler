// The static site owns draft answers; the API owns paid orders and saved results.
window.StayHustler = {
    apiBase: ['localhost', '127.0.0.1'].includes(location.hostname) ? `${location.protocol}//${location.hostname}:3000` : 'https://app.stayhustler.com',
    read(key, fallback = {}) {
        try { return JSON.parse(localStorage.getItem(`stayhustler_${key}`)) || fallback; }
        catch { return fallback; }
    }
};
try {
    const expires = Number(localStorage.getItem('stayhustler_draft_expires'));
    if (expires && expires <= Date.now()) {
        for (const key of Object.keys(localStorage)) if (key.startsWith('stayhustler_')) localStorage.removeItem(key);
    }
    if (!expires || expires <= Date.now()) localStorage.setItem('stayhustler_draft_expires', String(Date.now() + 30 * 86400000));
} catch { /* The form shows a storage error on submit if the browser blocks storage. */ }
