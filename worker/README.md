# Christian Steps Admin API

This Cloudflare Worker provides the private `/admin/` portal with Hope Sojourns-style authentication, PayPal Transaction Search synchronization, centralized D1 storage, manual product review, annual summaries, Excel export data, and donor/giving-letter data. A new sign-in requires explicit form submission; an existing valid session opens the CSM dashboard without another login. Browser-managed saved-password autofill and the remembered checkbox preference remain available.

The production Worker is deployed as `christian-steps-admin-api`; its D1 database and routes are configured in `wrangler.jsonc`.

## Deployment

The one-time production infrastructure is already configured:

- D1 database `christian-steps-admin`, with migrations applied.
- Encrypted `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` Worker secrets.
- Private `JBB_PAYPAL` service binding to the Josh Beyond Borders Worker, which keeps the shared PayPal credentials in one place.
- Static assets served from the ignored `public/admin/` staging directory on the `/admin/` routes.

To validate and deploy from this `worker` directory:

1. Install the exact development dependencies.
2. Run `npm test`.
3. Run `npm run check`. This automatically replaces `public/admin/` with the current files from `../admin/`, writes the private no-cache asset rules, runs TypeScript, and performs a dry deployment.
4. Run `npm run deploy` after deployment is approved. The deployment command repeats the asset refresh automatically.

The Admin Portal HTML, CSS, JavaScript, and favicon use versioned asset URLs and are served with `Cache-Control: no-store`. Read-only Admin API requests also bypass browser and intermediary caches. Income refreshes when the Ledger income route is entered or restored from browser history. This makes a PayPal pull refresh the visible table and summary immediately. Excel downloads are generated from a fresh API response and receive a unique timestamped filename.

## Portal navigation and dashboard scope

`/admin/` is the CSM home dashboard. Giving activity is `/admin/#/giving`, with PayPal pull, assignment to CSM/HS/JBB, and existing HS/JBB send-for-review actions. `/admin/ledger/` retains the financial workflows; its former Dashboard is labeled Finance overview. Personally received gifts and gift instructions retain their dedicated pages. These pages use the same shared session and linked navigation, and dashboard data is read through existing authenticated endpoints.

The dashboard calculation lives in `../admin/dashboard-data.js` and is covered by `test/dashboard-data.spec.ts`. CSM and HS recorded receipts combine completed PayPal contributions with included manual ledger payments; they never add an HS inbox copy of a CSM gift. Recorded operating outflow uses actual included CSM/HS/shared expense amounts plus PayPal contribution fees, rather than tax-deductible percentages. JBB PayPal funds are displayed as a separate pass-through responsibility, never CSM income. The JBB due figure is all-time net receipts less disbursements; the JBB received/sent program figures are current-year. The dashboard is not a bank balance or a consolidation of HS/JBB databases. Personally received gifts remain visible in Giving activity but are not silently counted again in the dashboard's ledger figures. When finance access is unavailable, the home view shows explicitly labeled PayPal-only giving figures instead of implying a full financial total.

The first portal sync automatically requests the full history available through PayPal's Transaction Search API. Later routine syncs refresh the most recent 93 days so refunds, reversals, and updated records are caught. The full-history action refreshes up to three years, which is the API's maximum historical window. Older PayPal records can still be retained by importing a separate historical archive in a future enhancement.

## Data rules

### Direct-bank Hope Sojourns donations

Use CSM Ledger > Income for a gift received directly into the shared CSM bank account. An existing paid income record can be marked `donation` and assigned to `HopeSojourns`; it is not recreated in Giving activity. The sender must confirm that the gift is not already in PayPal or Personally received gifts. `POST /api/admin/records/income/:id/send-to-hope` freezes the source and delivers a stable `LEDGER_DONATION` message to the HS Payment inbox. HS approval adds its budget/donor view of the same receipt. `ledger-migrations/0009_income_donation_delivery.sql` must be applied before deploying this Worker and its Ledger assets. Do not automatically send existing income records or copy CSM business data into HS test.

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

## Shared ministry accounts

See [shared account architecture and coordinated release](docs/shared-accounts.md). This implementation remains local pending release authorization; SHARED_SIGNIN is disabled until both portals are ready.


## Personally received gifts

See [implementation and release notes](docs/personal-gifts.md) and the [step-by-step process](docs/personally-received-gifts-process.md). Released September 23, 2026. The HS receiver was released separately from test-only planning changes.
