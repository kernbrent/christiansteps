# CSM master distribution runbook

## Phase 1 — contract and safety rules

- Use the versioned message contract in `src/csm-distribution-contract.ts`.
- Include completed received and sent PayPal payment events.
- Exclude all holds and releases by requiring a `T00xx` event code.
- Include Display Name in the message and every review screen.

## Phase 2 — CSM review

- Sync PayPal as usual and assign a destination product.
- Review the transaction, donor/payee snapshot, Display Name, direction, and amounts.
- Select only eligible rows and send them to the destination inbox.

## Phase 3 — reliable delivery

- Write the CSM outbox record before calling the destination's private service binding.
- Store every delivery attempt and response in the CSM audit tables.
- Insert accepted messages into each destination's D1 inbox, which is the durable review work queue.
- Retry failed or timed-out deliveries with the same idempotency key.
- Keep a complete audit trail and show recipient status in CSM.

## Phase 4 — Hope Sojourns inbox

- Insert every delivery idempotently.
- Match by an existing CSM link, then one unique exact email; never by name alone.
- Let an administrator approve, deny with a reason, choose an existing donor, or complete a proposed donor.
- Write the donor/link, financial entry, audit event, and inbox status atomically.

## Phase 5 — Josh Beyond Borders inbox

- Add a D1 donor and financial ledger beside the existing encrypted-workbook process.
- Apply the same idempotency, approval, denial, and audit rules used by Hope Sojourns.
- Match the encrypted workbook's donor list only in the signed-in browser; never upload that legacy donor directory to D1. Create a D1 donor record only when an incoming gift is approved without an existing D1 match.

## Phase 6 — validation

- Test received and sent payments, duplicate delivery, missing donor data, multiple email matches, denial, retry, and failure rollback.
- Test that `T2101` holds and `T2102` releases cannot be selected, sent, or accepted.
- Reconcile counts and gross, fee, and net totals by product, direction, and year.

## Phase 7 — shadow mode

- Deploy database migrations before application code.
- Start consumers, then enable CSM publishing.
- Leave existing PayPal ingestion paths available.
- Review both recipient inboxes and compare them with legacy data for the chosen reconciliation period.

## Phase 8 — cutover and rollback

- Cut over a destination only when its reconciliation has no unexplained differences and administrators have accepted the workflow.
- Disable only the recipient's legacy transaction ingestion. Do not disable public PayPal checkout, order capture, subscription, or webhook functions.
- Roll back by pausing CSM publishing, re-enabling the legacy ingestion UI/path, and retaining all inbox, outbox, and audit records for diagnosis.

## Production activation checklist

- Destination and CSM D1 migrations applied.
- Private destination delivery and CSM status service bindings configured.
- The same generated `CSM_DISTRIBUTION_SECRET` is installed on all three Workers.
- Admin authentication verified on every inbox action.
- Contract, duplicate-delivery, and atomic-approval tests passing.
- Counts and monetary totals reconciled.
- Inbox, outbox, audit records, and application logs reviewed for failures.
- Rollback owner and steps confirmed.
