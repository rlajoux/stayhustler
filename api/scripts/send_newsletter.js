#!/usr/bin/env node

/**
 * Send Newsletter Script
 * 
 * Sends a text newsletter to all subscribed users with unsubscribe links.
 * 
 * Usage:
 *   node scripts/send_newsletter.js --subject "..." --text "..." [--dry-run] [--limit 50]
 * 
 * Required env vars:
 *   DATABASE_URL
 *   SENDGRID_API_KEY
 *   SENDGRID_FROM_EMAIL
 *   PUBLIC_BASE_URL
 *   UNSUBSCRIBE_SECRET
 */

const { Pool } = require('pg');
const sgMail = require('@sendgrid/mail');
const crypto = require('crypto');
require('dotenv').config();

// Parse CLI arguments
function parseArgs() {
    const args = process.argv.slice(2);
    const parsed = {
        subject: null,
        text: null,
        dryRun: false,
        limit: 1000
    };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--subject' && args[i + 1]) {
            parsed.subject = args[i + 1];
            i++;
        } else if (args[i] === '--text' && args[i + 1]) {
            parsed.text = args[i + 1];
            i++;
        } else if (args[i] === '--dry-run') {
            parsed.dryRun = true;
        } else if (args[i] === '--limit' && args[i + 1]) {
            parsed.limit = parseInt(args[i + 1], 10);
            i++;
        }
    }

    return parsed;
}

// Generate unsubscribe token (same as server.js)
function signEmail(email) {
    const secret = process.env.UNSUBSCRIBE_SECRET || 'change-me-in-production';
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(email.toLowerCase().trim());
    return hmac.digest('hex');
}

// Generate unsubscribe link
function getUnsubscribeLink(email) {
    const baseUrl = process.env.PUBLIC_BASE_URL || 'https://stayhustler.com';
    const token = signEmail(email);
    return `${baseUrl}/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
}

// Sleep helper for rate limiting
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    const args = parseArgs();

    // Validate required arguments
    if (!args.subject || args.subject.trim().length === 0) {
        console.error('Error: --subject is required and cannot be empty');
        process.exit(1);
    }

    if (!args.text || args.text.length < 40) {
        console.error('Error: --text must be at least 40 characters');
        process.exit(1);
    }

    // Validate environment variables
    if (!process.env.DATABASE_URL) {
        console.error('Error: DATABASE_URL not set');
        process.exit(1);
    }

    if (!process.env.SENDGRID_API_KEY) {
        console.error('Error: SENDGRID_API_KEY not set');
        process.exit(1);
    }

    if (!process.env.SENDGRID_FROM_EMAIL) {
        console.error('Error: SENDGRID_FROM_EMAIL not set');
        process.exit(1);
    }

    // Configure SendGrid
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    // Connect to database
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    try {
        // Fetch subscribers
        console.log(`Fetching up to ${args.limit} subscribed recipients...`);
        const result = await pool.query(`
            SELECT email FROM newsletter_subscribers
            WHERE status = 'subscribed'
            ORDER BY created_at ASC
            LIMIT $1
        `, [args.limit]);

        const recipients = result.rows;
        console.log(`Found ${recipients.length} recipients`);

        if (recipients.length === 0) {
            console.log('No recipients to send to.');
            await pool.end();
            process.exit(0);
        }

        // Dry run mode
        if (args.dryRun) {
            console.log('\n===== DRY RUN MODE =====');
            console.log(`Subject: ${args.subject}`);
            console.log(`\nFirst 3 recipients:`);
            recipients.slice(0, 3).forEach((r, i) => {
                console.log(`  ${i + 1}. ${r.email}`);
            });
            
            // Show rendered text with sample unsubscribe link
            const sampleEmail = recipients[0].email;
            const unsubLink = getUnsubscribeLink(sampleEmail);
            const fullText = `${args.text}\n\n—\nTo unsubscribe: ${unsubLink}\n`;
            
            console.log(`\nRendered text (for ${sampleEmail}):`);
            console.log('---');
            console.log(fullText);
            console.log('---');
            console.log('\nDry run complete. No emails sent.');
            
            await pool.end();
            process.exit(0);
        }

        // Send emails
        console.log('\nSending emails...');
        let successCount = 0;
        let failureCount = 0;
        const failures = [];

        for (const recipient of recipients) {
            try {
                const unsubLink = getUnsubscribeLink(recipient.email);
                const fullText = `${args.text}\n\n—\nTo unsubscribe: ${unsubLink}\n`;

                const msg = {
                    to: recipient.email,
                    from: process.env.SENDGRID_FROM_EMAIL,
                    subject: args.subject,
                    text: fullText
                };

                await sgMail.send(msg);
                console.log(`✓ sent: ${recipient.email}`);
                successCount++;

                // Rate limiting: 100ms delay between sends
                await sleep(100);

            } catch (err) {
                console.error(`✗ failed: ${recipient.email} (${err.code || err.message})`);
                failureCount++;
                failures.push({ email: recipient.email, error: err.code || err.message });
            }
        }

        // Summary
        console.log('\n===== SUMMARY =====');
        console.log(`Total recipients: ${recipients.length}`);
        console.log(`Sent: ${successCount}`);
        console.log(`Failed: ${failureCount}`);

        if (failures.length > 0) {
            console.log('\nFailures:');
            failures.forEach(f => console.log(`  - ${f.email}: ${f.error}`));
        }

        await pool.end();

        // Exit with error if >20% failures
        const failureRate = failureCount / recipients.length;
        if (failureRate > 0.2) {
            console.error(`\nError: Failure rate ${(failureRate * 100).toFixed(1)}% exceeds 20% threshold`);
            process.exit(1);
        }

        process.exit(0);

    } catch (err) {
        console.error('Fatal error:', err.message);
        await pool.end();
        process.exit(1);
    }
}

main();
