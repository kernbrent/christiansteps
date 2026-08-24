# Christian Steps Admin API

This Cloudflare Worker provides the private `/admin/` portal with Hope Sojourns-style authentication, PayPal Transaction Search synchronization, centralized D1 storage, manual product review, annual summaries, Excel export data, and donor/giving-letter data.

The production Worker is deployed as `christian-steps-admin-api`; its D1 database and routes are configured in `wrangler.jsonc`.

## Deployment

The one-time production infrastructure is already configured:

- D1 database `christian-steps-admin`, with migrations applied.
- Encrypted `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` Worker secrets.
- Private `JBB_PAYPAL` service binding to the Josh Beyond Borders Worker, which keeps the shared PayPal credentials in one place.
- Static assets served from the ignored `public/admin/` staging directory on the `/admin/` routes.

To validate and deploy from this `worker` directory:

1. Install the exact development dependencies.
2. Copy the source files from `../admin/` into `public/admin/`.
3. Run the tests, TypeScript check, and `wrangler deploy --dry-run`.
4. Run `wrangler deploy` after deployment is approved.

The first portal sync automatically requests the full history available through PayPal's Transaction Search API. Later routine syncs refresh the most recent 93 days so refunds, reversals, and updated records are caught. The full-history action refreshes up to three years, which is the API's maximum historical window. Older PayPal records can still be retained by importing a separate historical archive in a future enhancement.

## Data rules

- D1 is the canonical stored record. The portal's **Download Excel workbook** action creates a current `.xlsx` snapshot with a summary sheet and all normalized and raw PayPal fields.
- Current-year summary cards count completed PayPal payment events (`T00xx`) only: the large amount is gross donations received, and the smaller amount is money sent to another account. Holds and hold releases such as `T2101` and `T2102` are excluded.
- Each summary card also reports the number of donation transactions and distinct givers. Givers are matched by email, with name and transaction ID used as fallbacks when needed.
- The activity table defaults to payment events so it matches PayPal's normal Activity view. PayPal account holds (`T2101`) and releases (`T2102`) remain stored and exported, and can be reviewed with the Activity filter where they are linked to the original donor payment.
- PayPal item title, item ID, subject, invoice, and custom fields are used for automatic product classification.
- Unclear records are marked **Needs review**. A manual product choice is retained through later PayPal syncs.
- Giving letters include only completed positive USD PayPal payment events assigned to one of the three ministry products.
- Newest transactions are returned first; giving-letter detail rows are chronological.

## Security

- Passwords changed through the portal are stored as PBKDF2-SHA256 hashes in D1.
- Sessions use random, hashed tokens in HttpOnly, Secure, SameSite=Strict cookies.
- State-changing requests require a CSRF token and an approved site origin.
- Sign-in attempts are rate limited, password changes revoke other sessions, and security events are audited without recording passwords or PayPal credentials.
