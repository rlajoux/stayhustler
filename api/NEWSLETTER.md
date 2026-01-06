# Newsletter System

Manual newsletter sending for StayHustler with SendGrid integration and one-click unsubscribe.

## Environment Variables

Add these to Railway:

```bash
SENDGRID_API_KEY=<your-sendgrid-api-key>
SENDGRID_FROM_EMAIL=newsletter@stayhustler.com
PUBLIC_BASE_URL=https://stayhustler.com
UNSUBSCRIBE_SECRET=<generate-a-long-random-string>
```

**Important:**
- `SENDGRID_FROM_EMAIL` must be a verified sender in SendGrid
- `UNSUBSCRIBE_SECRET` should be a long random string (e.g., 64+ chars)

## SendGrid Setup

1. Sign up at https://sendgrid.com
2. Create an API key with "Mail Send" permissions
3. Verify your sender email/domain in SendGrid dashboard

## Usage

### Dry Run (Test)

Test without sending emails:

```bash
npm run send:newsletter -- \
  --subject "Your first hotel tip" \
  --text "Here's your weekly tip: Always mention your arrival time when requesting upgrades. Hotels can plan better when they know you're arriving Thursday at 3pm versus 'sometime Thursday.'" \
  --dry-run \
  --limit 5
```

This will:
- Show first 3 recipient emails
- Display the rendered email text with unsubscribe link
- NOT send any actual emails

### Send Newsletter

Send to all subscribers:

```bash
npm run send:newsletter -- \
  --subject "Your first hotel tip" \
  --text "Here's your weekly tip: Always mention your arrival time when requesting upgrades. Hotels can plan better when they know you're arriving Thursday at 3pm versus 'sometime Thursday.'"
```

Send to limited recipients (e.g., testing):

```bash
npm run send:newsletter -- \
  --subject "Test newsletter" \
  --text "This is a test of the newsletter system. You're receiving this because you subscribed to StayHustler weekly tips." \
  --limit 10
```

## Features

- **Rate Limited**: 100ms delay between sends to avoid spikes
- **Unsubscribe Links**: Automatically appended to every email
- **Error Handling**: Continues on individual failures, exits with error if >20% fail
- **Safety Checks**: Requires subject and text >40 chars

## API Endpoints

### Check Status

```bash
# Get subscribed count
curl https://stayhustler-production.up.railway.app/api/subscribers/count

# Get status breakdown
curl https://stayhustler-production.up.railway.app/api/subscribers/status
```

### Test Unsubscribe

Generate a test unsubscribe link:

```bash
node -e "
const crypto = require('crypto');
const email = 'test@example.com';
const secret = process.env.UNSUBSCRIBE_SECRET;
const hmac = crypto.createHmac('sha256', secret);
hmac.update(email.toLowerCase());
const token = hmac.digest('hex');
console.log(\`https://stayhustler.com/unsubscribe?email=\${encodeURIComponent(email)}&token=\${token}\`);
"
```

## Troubleshooting

**Script fails with "SENDGRID_API_KEY not set"**
- Ensure the variable is set in Railway
- Run script from `/api` directory: `cd api && npm run send:newsletter ...`

**"No recipients to send to"**
- Check subscriber count: `curl https://stayhustler-production.up.railway.app/api/subscribers/count`
- Subscribers must have `status='subscribed'`

**Emails not delivering**
- Check SendGrid dashboard for delivery logs
- Verify sender email is confirmed in SendGrid
- Check spam folder

## Security

- Unsubscribe tokens are HMAC-SHA256 signed and verified with constant-time comparison
- No email addresses are exposed in URLs (only signed tokens)
- Tokens are tied to specific email addresses and cannot be reused
