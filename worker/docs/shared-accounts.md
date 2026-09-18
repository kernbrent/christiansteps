# Shared ministry accounts

Local implementation, September 17, 2026. Not deployed or activated.

HS is the shared identity authority. CSM uses a private Cloudflare service binding named IDENTITY to the HS Worker entrypoint CsmIdentity. The payment integration's secret and binding do not grant identity authority. No identity endpoint is exposed through the default public HS handler.

Each person has one immutable username, password hash, name, email, phone, registration date, last successful login, global status, and Organization Administrator role. HS and CSM memberships independently control portal access, Portal Administrator status, and section permissions. HS retains its six sections. CSM separates giving/PayPal/distribution from bookkeeping/invoices/mileage/files. Bookkeeping's combined bootstrap requires finance read access. Its related data remain one finance section; invoice/client file records are not separate permission partitions in this release.

Organization Administrators can manage shared identity, grant either portal, appoint administrators, suspend globally, and delete shared accounts. Portal Administrators can create new accounts with access only to their own portal, change that membership, and send reset instructions to an existing account email. They cannot receive an existing user's fallback reset token, issue temporary passwords, change another person's identity, modify Organization Administrators, or grant the other portal. An existing account requesting the second portal must be linked by an Organization Administrator after identity verification. Linking preserves its password and existing membership. Users edit their own shared profile and password.

Removing portal membership revokes access only to that portal. Global suspension, deletion, temporary password issuance, and password resets revoke shared sessions. Password change preserves the current session and ends other sessions. Deletion releases username/email for reuse and preserves historical user IDs. Database triggers protect the last usable Organization Administrator. Access/profile changes record actor, timestamp, and before/after settings; CSM mutations record actor and route in shared_account_activity. Existing finance owners stay primary, and financial data are not migrated.

## Browser and session behavior

Each host has its own HttpOnly, Secure, SameSite=Strict session cookie. CSM's adapter translates its cookie only over the private binding. Shared sessions are centrally stored as token hashes and scoped to hs or csm. Authorization checks current membership and permissions on every request. There is no fallback to the legacy password when shared authentication is active or unavailable.

The switch link appears only for accounts with active access to both portals. The destination starts a browser-bound challenge using a 120-second HttpOnly, Secure, SameSite=Lax verifier cookie. The source issues a 60-second, single-use code tied to that challenge, the source session, and destination portal. The callback code travels in a fragment and is removed from browser history immediately. Redemption rechecks both memberships and the source session, consumes the code atomically, and creates the destination session. Passwords and session tokens never travel in redirect URLs. Redirect hosts are fixed configured portal origins and their approved www variants.

Both portals provide /admin/account/, /admin/access/, and /admin/shared-signin/. CSM's /api/admin/account/* and /public/account/* proxy shared account operations. Invitations and recovery continue using the existing HS email service; CSM-only invitations link to CSM's setup screen. No invitation or live email is sent by automated tests.

## Coordinated release

Commit, push, and deployment require Brent's explicit release instruction. The checked-in SHARED_SIGNIN flags remain disabled until that instruction. Do not activate one environment against another environment's accounts.

1. Review the two repositories and exclude unrelated public-site redesign files. Back up both administration databases before applying migrations. Verify the existing HS primary account is Brent's active admin account with a working password. No email-based automatic account merging is performed.
2. After release authorization, change SHARED_SIGNIN to enabled for HS production and CSM. Keep HS test disabled unless deploying a separate test CSM binding. Refresh local generated bindings and rerun checks.
3. Apply HS migration 0025. It preserves user IDs, seeds only primary as Organization Administrator with CSM access, adds separate membership fields and session audiences, and creates switch-code storage. Other HS users retain their existing HS roles and have no CSM access by default.
4. Deploy the HS Worker, including its private CsmIdentity entrypoint. Existing HS sessions remain valid. Do not point a test CSM Worker at production identity.
5. Apply CSM migration 0004. It ends legacy unattributed CSM sessions and adds the attributable activity table. Deploy CSM with IDENTITY bound to hope-sojourns-interest-production and entrypoint CsmIdentity. CSM's canonical admin assets are included by assets:sync.
6. Publish only the affected HS admin assets. Brent signs into CSM with the existing HS admin password. Verify profile, role editing, request approval, blocked/read-only access, switching both ways, suspension, last-login display, and existing financial totals before announcing availability.

For an outage, fail closed and repair the authority/binding. Do not silently restore the old shared CSM password or revive old sessions. Reverting to legacy authentication would discard shared access enforcement and requires an explicit reviewed rollback. Preserve the additive schema and historical user IDs.

## Local validation and maintenance

HS: npm run check, npm test, npm run deploy:dry; palette check and living-guide generation/render/sync. CSM: npm run check and npm test. HS unit tests use real SQLite migrations. The runtime test uses an isolated Workers runtime, D1, and the named binding; CSM adapter tests validate cookie translation, origin checks, failure behavior, and authorization scope. Independent checkouts can run their tests without a sibling repository. The two-portal browser check used isolated local Workers, databases, and dummy identities.

The account UI, phone formatter, and switch script have canonical copies in HS admin/account, phone-ui.js, and admin/shared-signin. Keep CSM's corresponding admin copies synchronized when changing their shared behavior. CSM account layout/theme are local admin assets; they do not replace the public site's styling. CSM's worker-configuration.d.ts remains its existing manually maintained environment contract; update its binding declarations with configuration changes.
