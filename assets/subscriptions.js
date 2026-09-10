// Confirm subscriptions only after the server has accepted the email address.
for (const form of document.querySelectorAll('[data-subscribe-source]')) {
    const button = form.querySelector('button[type="submit"]');
    const message = document.getElementById(form.dataset.subscribeMessage);
    form.addEventListener('submit', async event => {
        event.preventDefault();
        button.disabled = true;
        message.classList.add('visible');
        message.textContent = 'Subscribing…';
        try {
            const response = await fetch(StayHustler.apiBase + '/api/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: form.querySelector('input[type="email"]').value.trim(), source: form.dataset.subscribeSource }),
                signal: AbortSignal.timeout(15000)
            });
            if (!response.ok) throw new Error('Subscription unavailable');
            form.hidden = true;
            message.textContent = 'You’re on the list.';
        } catch {
            message.textContent = 'We couldn’t subscribe you. Please try again.';
        } finally { button.disabled = false; }
    });
}
