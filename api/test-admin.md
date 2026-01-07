# Admin Area Testing Guide

## Prerequisites

Set environment variables in Railway:
```bash
ADMIN_USER=admin
ADMIN_PASS=your_secure_password_123
```

## Manual Testing Checklist

### 1. Authentication Tests

#### Test: No credentials
```bash
curl https://your-railway-app.up.railway.app/admin
```
Expected: 401 Unauthorized with `WWW-Authenticate: Basic realm="StayHustler Admin"` header

#### Test: Invalid credentials
```bash
curl -u "wrong:credentials" https://your-railway-app.up.railway.app/admin
```
Expected: 401 Unauthorized

#### Test: Valid credentials
```bash
curl -u "admin:your_secure_password_123" https://your-railway-app.up.railway.app/admin
```
Expected: 200 OK with HTML dashboard

### 2. Dashboard Test

Visit in browser: `https://your-railway-app.up.railway.app/admin`
- Enter credentials when prompted
- Should see:
  - Newsletter Subscribers card with counts
  - Request Deliveries card with counts
  - Links to subscribers and deliveries pages

### 3. Subscribers Page Tests

Visit: `https://your-railway-app.up.railway.app/admin/subscribers`
- Should show table with columns: email, status, source, created, unsubscribed
- Test pagination: Click "Next" and "Previous" buttons
- Test filter: Select "Subscribed" or "Unsubscribed" from dropdown
- Test CSV export: Click "Download CSV"

#### Test filter with curl
```bash
curl -u "admin:your_secure_password_123" \
  "https://your-railway-app.up.railway.app/admin/subscribers?status=subscribed"
```
Expected: HTML with filtered results

### 4. Deliveries Page Tests

Visit: `https://your-railway-app.up.railway.app/admin/deliveries`
- Should show table with columns: id, email, status, error, created
- Test pagination
- Test filter: Select "Sent" or "Failed"
- Test CSV export

### 5. CSV Export Tests

#### Subscribers CSV
```bash
curl -u "admin:your_secure_password_123" \
  "https://your-railway-app.up.railway.app/admin/api/subscribers.csv" \
  -o subscribers.csv
```
Expected: CSV file with headers: email,status,source,created_at,unsubscribed_at

#### Deliveries CSV
```bash
curl -u "admin:your_secure_password_123" \
  "https://your-railway-app.up.railway.app/admin/api/deliveries.csv" \
  -o deliveries.csv
```
Expected: CSV file with headers: id,email,status,error,created_at

#### Filtered CSV
```bash
curl -u "admin:your_secure_password_123" \
  "https://your-railway-app.up.railway.app/admin/api/subscribers.csv?status=subscribed" \
  -o subscribed.csv
```
Expected: CSV with only subscribed users

### 6. Security Tests

#### Verify X-Robots-Tag header
```bash
curl -I -u "admin:your_secure_password_123" \
  https://your-railway-app.up.railway.app/admin
```
Expected: Response includes `X-Robots-Tag: noindex, nofollow`

#### Verify public routes still work without auth
```bash
curl https://your-railway-app.up.railway.app/health
```
Expected: 200 OK with `{"ok":true,...}`

```bash
curl https://your-railway-app.up.railway.app/api/health
```
Expected: 200 OK

### 7. Edge Cases

#### Test missing env vars
1. Temporarily remove ADMIN_USER from Railway
2. Visit /admin
Expected: 503 "Admin access not configured"

#### Test pagination boundaries
Visit: `/admin/subscribers?page=999999`
Expected: Empty results, no crashes

#### Test invalid status filter
Visit: `/admin/subscribers?status=invalid`
Expected: Shows all records (ignores invalid filter)

## Success Criteria

- ✅ All /admin routes require authentication
- ✅ Wrong credentials show 401
- ✅ Correct credentials show data
- ✅ Pagination works (Next/Prev buttons)
- ✅ Filters work (status dropdowns)
- ✅ CSV exports download correctly
- ✅ X-Robots-Tag header present on all admin pages
- ✅ Public routes (/health, /api/*) work without auth
- ✅ No sensitive data (booking JSON, generated emails) visible
- ✅ Browser shows login prompt for /admin (HTTP Basic Auth)
