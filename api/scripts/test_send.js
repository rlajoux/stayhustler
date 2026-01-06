#!/usr/bin/env node

/**
 * Quick test script to send one newsletter email
 * 
 * Usage:
 *   node scripts/test_send.js <recipient-email>
 * 
 * Example:
 *   node scripts/test_send.js rlajoux@gmail.com
 */

const sgMail = require('@sendgrid/mail');
const crypto = require('crypto');
require('dotenv').config();

const recipientEmail = process.argv[2];

if (!recipientEmail) {
    console.error('Usage: node scripts/test_send.js <recipient-email>');
    process.exit(1);
}

// Check required env vars
const required = ['SENDGRID_API_KEY', 'SENDGRID_FROM_EMAIL', 'PUBLIC_BASE_URL', 'UNSUBSCRIBE_SECRET'];
const missing = required.filter(v => !process.env[v]);

if (missing.length > 0) {
    console.error(`Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
}

// Generate unsubscribe link
function signEmail(email) {
    const secret = process.env.UNSUBSCRIBE_SECRET;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(email.toLowerCase().trim());
    return hmac.digest('hex');
}

function getUnsubscribeLink(email) {
    const baseUrl = process.env.PUBLIC_BASE_URL;
    const token = signEmail(email);
    return `${baseUrl}/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
}

async function sendTest() {
    try {
        sgMail.setApiKey(process.env.SENDGRID_API_KEY);

        const unsubLink = getUnsubscribeLink(recipientEmail);
        const text = `Hello! This is a test newsletter from StayHustler.

Here's your weekly hotel upgrade tip:

Always mention your arrival day and time when requesting upgrades. Hotels can plan better when they know you're arriving "Thursday at 3pm" versus "sometime Thursday."

This specificity shows you understand hotel operations and makes it easier for the front desk to identify available inventory before you arrive.

More tips coming next week!

—
To unsubscribe: ${unsubLink}
`;

        const msg = {
            to: recipientEmail,
            from: process.env.SENDGRID_FROM_EMAIL,
            subject: 'Test Newsletter from StayHustler',
            text: text
        };

        console.log(`Sending test email to: ${recipientEmail}`);
        console.log(`From: ${process.env.SENDGRID_FROM_EMAIL}`);
        console.log(`Unsubscribe link: ${unsubLink}\n`);

        await sgMail.send(msg);
        
        console.log('✓ Email sent successfully!');
        console.log('\nCheck your inbox (and spam folder) for the test email.');
        
    } catch (err) {
        console.error('✗ Failed to send email:', err.message);
        if (err.response) {
            console.error('SendGrid response:', err.response.body);
        }
        process.exit(1);
    }
}

sendTest();
