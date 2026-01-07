# StayHustler Admin Area

Secure, read-only admin dashboard for viewing newsletter subscribers and request deliveries.

## Setup

### 1. Environment Variables (Railway)

Add these environment variables to your Railway project:

```bash
ADMIN_USER=your_username_here
ADMIN_PASS=your_strong_password_here
```

Optional:
```bash
ADMIN_PATH=/admin  # Default if not set
```

### 2. Access

Visit: `https://your-railway-domain.up.railway.app/admin`

The browser will prompt for username and password (HTTP Basic Auth).

## Routes

All routes are protected by HTTP Basic Auth and return `X-Robots-Tag: noindex, nofollow`.

### Dashboard
- **GET /admin** - Overview with counts and links

### Subscribers
- **GET /admin/subscribers** - View all newsletter subscribers
  - Query params: `?page=1&limit=50&status=subscribed`
  - Columns: email, status, source, created_at, unsubscribed_at
  - Sort: newest first
  - Export: Download CSV button

### Deliveries
- **GET /admin/deliveries** - View all request deliveries
  - Query params: `?page=1&limit=50&status=sent`
  - Columns: id, email, status, error, created_at
  - Sort: newest first
  - Export: Download CSV button

### CSV Exports
- **GET /admin/api/subscribers.csv** - Export subscribers
  - Supports `?status=subscribed|unsubscribed`
- **GET /admin/api/deliveries.csv** - Export deliveries
  - Supports `?status=sent|failed`

## Security

- ✅ HTTP Basic Auth on all /admin routes
- ✅ Credentials from environment variables (never hardcoded)
- ✅ Constant-time comparison to prevent timing attacks
- ✅ X-Robots-Tag header prevents search engine indexing
- ✅ No credentials logged
- ✅ Railway provides automatic TLS/HTTPS
- ✅ Public API routes (/api/generate-request, /api/subscribe, etc.) are NOT affected

## Privacy

- ❌ Does NOT display booking/context JSON
- ❌ Does NOT display full generated email body
- ✅ Shows only operational metadata (email, status, timestamps, errors)

## Testing

1. **Without credentials**: Visit /admin → Should prompt for login
2. **Wrong credentials**: Enter incorrect user/pass → Should show 401 Unauthorized
3. **Correct credentials**: Enter correct user/pass → Should show dashboard
4. **Pagination**: Click Next/Previous on subscribers/deliveries pages
5. **Filters**: Use status dropdown to filter by subscribed/unsubscribed or sent/failed
6. **CSV Export**: Click "Download CSV" → Should download file with filtered data
7. **Public routes**: Verify /api/generate-request, /health still work without auth

## Notes

- **Read-only**: No delete/edit functionality (MVP scope)
- **Performance**: Pagination limits to 200 records per page max
- **Public routes**: /api/* and /health endpoints remain public (no auth required)
- **Styling**: Inline CSS for simplicity (no external dependencies)
