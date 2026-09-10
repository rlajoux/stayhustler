(function () {
    'use strict';
    const catalogue = window.StayHustlerLoyalty;
    const programmeSelect = document.getElementById('loyalty-programme');
    const tierSelect = document.getElementById('loyalty-tier');
    const tierGroup = document.getElementById('loyalty-tier-group');
    const confirmed = document.getElementById('loyalty-hotel-confirmed');
    const confirmationGroup = document.getElementById('loyalty-confirmation');
    const card = document.getElementById('loyalty-benefits');
    const note = document.getElementById('loyalty-selection-note');
    const booking = StayHustler.read('booking');
    const saved = StayHustler.read('context');
    const legacy = saved.loyaltyStatus || saved.loyalty;
    programmeSelect.required = saved.loyaltyProgramme === undefined && !!legacy && legacy !== 'none';
    for (const programme of catalogue.programmes) programmeSelect.add(new Option(programme.name, programme.id));
    for (const [value, label] of [['other', 'Other programme'], ['unknown', 'Not sure']]) programmeSelect.add(new Option(label, value));

    function selection() {
        return { loyaltyProgramme: programmeSelect.value, loyaltyTier: tierSelect.value, loyaltyHotelConfirmed: confirmed.checked };
    }

    function updateTiers() {
        const programme = catalogue.getProgramme(programmeSelect.value);
        tierSelect.replaceChildren(new Option('Select your tier', ''));
        if (programme) {
            for (const tier of programme.tiers) tierSelect.add(new Option(tier.name, tier.id));
            tierSelect.add(new Option('I do not know my tier', 'unknown'));
        }
        tierGroup.hidden = !programme;
        tierSelect.required = !!programme;
        tierSelect.disabled = !programme;
        confirmed.checked = false;
    }

    function element(tag, text, className) {
        const node = document.createElement(tag);
        node.textContent = text;
        if (className) node.className = className;
        return node;
    }

    function benefitList(benefits) {
        const list = document.createElement('dl');
        list.className = 'loyalty-benefit-list';
        for (const benefit of benefits) {
            const row = document.createElement('div');
            const description = document.createElement('dd');
            description.append(element('span', benefit.status, 'loyalty-condition'), element('span', benefit.detail));
            row.append(element('dt', benefit.name), description);
            list.append(row);
        }
        return list;
    }

    function render() {
        const data = selection();
        const programme = catalogue.getProgramme(data.loyaltyProgramme);
        const selectedTier = catalogue.getTier(programme, data.loyaltyTier);
        confirmationGroup.hidden = !selectedTier;
        confirmed.disabled = !selectedTier;
        if (!selectedTier) confirmed.checked = false;
        document.getElementById('loyalty-confirmation-label').textContent = programme
            ? `This hotel participates in ${programme.name}${programme.id === 'radisson' ? ' (outside the Americas)' : ''}.` : '';
        const advice = catalogue.describe(selection(), booking);
        card.hidden = !advice || !data.loyaltyTier;
        card.replaceChildren();
        if (!programme) {
            note.textContent = programmeSelect.required && !data.loyaltyProgramme
                ? 'Your saved draft has a generic loyalty status. Please choose the actual programme and tier, or “Not sure”, before continuing.'
                : ['other', 'unknown'].includes(data.loyaltyProgramme)
                ? 'You can continue. We will not claim a programme benefit or membership tier in your request.'
                : 'Choose your actual programme and tier. No account connection or membership number is needed.';
            return;
        }
        note.textContent = selectedTier ? 'Your selected status is not independently verified.' : 'Select your tier, or choose “I do not know my tier”.';
        if (card.hidden) return;
        card.append(element('p', 'Your selected status', 'loyalty-eyebrow'), element('h3', advice.label), element('p', advice.eligibility, 'loyalty-eligibility'));
        if (advice.benefits.length) {
            const requestType = document.querySelector('input[name="request-type"]:checked')?.value || 'upgrade';
            const relevantKeys = catalogue.requestCategories[requestType] || [];
            const relevant = advice.benefits.filter(benefit => relevantKeys.includes(benefit.key));
            const other = advice.benefits.filter(benefit => !relevantKeys.includes(benefit.key));
            if (relevant.length) card.append(benefitList(relevant));
            if (other.length) {
                const otherPerks = document.createElement('details');
                otherPerks.className = 'loyalty-other-perks';
                otherPerks.append(element('summary', `Other stay benefits (${other.length})`), benefitList(other));
                card.append(otherPerks);
            }
        } else card.append(element('p', 'Choose a known tier to see its stay benefits. We will not guess your status.'));
        const details = document.createElement('details');
        details.append(element('summary', 'Hotel exceptions and official sources'), element('p', advice.note));
        const links = document.createElement('p');
        advice.sources.forEach((url, index) => {
            if (index) links.append(document.createTextNode(' · '));
            const link = element('a', `Official source ${index + 1}`);
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            links.append(link);
        });
        details.append(links);
        card.append(details, element('p', 'Programme rules checked 10 September 2026. The hotel confirms booking eligibility and availability.', 'form-helper'));
    }

    programmeSelect.addEventListener('change', () => { updateTiers(); render(); });
    tierSelect.addEventListener('change', render);
    confirmed.addEventListener('change', render);
    document.querySelectorAll('input[name="request-type"]').forEach(input => input.addEventListener('change', render));
    if (typeof saved.loyaltyProgramme === 'string') programmeSelect.value = saved.loyaltyProgramme;
    updateTiers();
    if (typeof saved.loyaltyTier === 'string') tierSelect.value = saved.loyaltyTier;
    confirmed.checked = saved.loyaltyHotelConfirmed === true && !!catalogue.getTier(catalogue.getProgramme(programmeSelect.value), tierSelect.value);
    render();
    window.StayHustlerLoyaltyForm = {
        selection, refresh: render,
        valid: () => programmeSelect.checkValidity() && tierSelect.checkValidity() && catalogue.selectionErrors(selection()).length === 0
    };
})();
