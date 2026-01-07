# Admin Area Deployment Checklist

## Pre-Deployment

### 1. Push to Git
```bash
git push origin main
```

### 2. Configure Railway Environment Variables

Log in to Railway dashboard and add these variables:

**Required:**
```
ADMIN_USER=choose_your_username
ADMIN_PASS=generate_a_strong_password_here
```

**Optional:**
```
ADMIN_PATH=/admin  # Default value, can customize
```

### Password Generation
Use a strong password generator:
```bash
# Option 1: Generate random password (macOS/Linux)
openssl rand -base64 32

# Option 2: Use a password manager
# 1Password, Bitwarden, LastPass, etc.
```

## Deployment

### 3. Deploy to Railway

Railway will automatically deploy when you push to main (if auto-deploy is enabled).

Or trigger manual deployment:
- Go to Railway dashboard
- Click "Deploy" on your project
- Wait for build to complete

### 4. Verify Deployment

Check that the service is running:
```bash
curl https://your-app-name.up.railway.app/health
```

Expected response:
```json
{"ok":true,"timestamp":"2025-01-07T..."}
```

## Post-Deployment Testing

### 5. Test Admin Access

#### Test 1: No credentials
```bash
curl https://your-app-name.up.railway.app/admin
```
✅ Expected: 401 Unauthorized with `WWW-Authenticate: Basic realm="StayHustler Admin"`

#### Test 2: Wrong credentials
```bash
curl -u "wrong:credentials" https://your-app-name.up.railway.app/admin
```
✅ Expected: 401 Unauthorized

#### Test 3: Correct credentials
```bash
curl -u "your_username:your_password" https://your-app-name.up.railway.app/admin
```
✅ Expected: 200 OK with HTML dashboard

#### Test 4: Browser access
1. Open browser
2. Visit: `https://your-app-name.up.railway.app/admin`
3. Browser should show login prompt
4. Enter credentials
5. Should see dashboard with subscriber and delivery counts

### 6. Verify Security Headers

```bash
curl -I -u "your_username:your_password" https://your-app-name.up.railway.app/admin
```

✅ Check for header: `X-Robots-Tag: noindex, nofollow`

### 7. Test Public Routes Still Work

```bash
# Health check (no auth required)
curl https://your-app-name.up.railway.app/health

# API health check (no auth required)
curl https://your-app-name.up.railway.app/api/health

# Newsletter subscription (no auth required)
curl -X POST https://your-app-name.up.railway.app/api/subscribe \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","source":"test"}'
```

✅ All should work WITHOUT authentication

### 8. Test Admin Features

Visit in browser (authenticated):

1. **Dashboard**: `/admin`
   - ✅ Shows subscriber count
   - ✅ Shows delivery count
   - ✅ Links to subscribers and deliveries

2. **Subscribers**: `/admin/subscribers`
   - ✅ Table displays data
   - ✅ Pagination works (Next/Previous)
   - ✅ Filter by status works
   - ✅ CSV download works

3. **Deliveries**: `/admin/deliveries`
   - ✅ Table displays data
   - ✅ Pagination works
   - ✅ Filter by status works
   - ✅ CSV download works

### 9. Security Verification

- ✅ No credentials visible in logs
- ✅ Admin routes not indexed by search engines (X-Robots-Tag header)
- ✅ No booking/context JSON visible in admin UI
- ✅ No generated email content visible in admin UI
- ✅ HTTPS enforced (Railway default)
- ✅ Constant-time credential comparison (timing attack protection)

## Troubleshooting

### Issue: "Admin access not configured"
**Cause:** ADMIN_USER or ADMIN_PASS not set in Railway
**Fix:** Add environment variables in Railway dashboard

### Issue: 401 Unauthorized with correct credentials
**Cause:** Possible special characters in password or username
**Fix:** 
1. Use alphanumeric password without special characters
2. Or ensure password is properly escaped in Railway env vars

### Issue: Can't access admin but public routes work
**Cause:** Browser cached old credentials or network issue
**Fix:**
1. Clear browser cache/cookies
2. Try incognito/private window
3. Try different browser

### Issue: CSV downloads show HTML instead of CSV
**Cause:** Not authenticated or wrong endpoint
**Fix:** Ensure you're logged in and using correct URL

## Rollback Plan

If issues arise:

1. **Revert Git:**
   ```bash
   git revert HEAD
   git push origin main
   ```

2. **Remove Environment Variables:**
   - Go to Railway dashboard
   - Remove ADMIN_USER and ADMIN_PASS
   - Admin routes will return 503 but public routes still work

3. **Emergency Disable:**
   - Set `ADMIN_USER=` (empty) in Railway
   - Admin will be disabled but app continues to function

## Monitoring

After deployment, monitor:

1. **Railway Logs:**
   - Check for `[Admin]` log entries
   - Watch for authentication attempts
   - Look for errors

2. **Admin Usage:**
   - Track who accesses admin (IP in logs if needed)
   - Monitor for unusual activity

3. **Public API Performance:**
   - Ensure admin routes don't affect public API latency
   - Check /health endpoint regularly

## Success Criteria

- ✅ Admin dashboard accessible with credentials
- ✅ Public API routes work without authentication
- ✅ Pagination and filters work correctly
- ✅ CSV exports download successfully
- ✅ Security headers present (X-Robots-Tag)
- ✅ No sensitive data exposed in admin UI
- ✅ No credentials in logs
- ✅ HTTPS enforced
