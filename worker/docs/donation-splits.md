# Donation allocations

In the ledger's PayPal & Funds view, use Split donation for a completed USD CSM or HS incoming payment. Assign 2–100 donor rows with first and last name, optional email, original gift date, positive amount, and note. Amounts must equal gross before fees. Original PayPal transactions and the ledger projection remain unchanged and counted once.

Migration 0003 creates donation_splits, append-only donation_split_history, and transactional validation and revision guards. GET/PUT /api/admin/donation-splits/:sourceRecordId use the existing authenticated session and CSRF/origin checks. Undo stores an empty allocation list with a new history revision. Database guards reject stale totals or concurrent transfer attempts.

Before distribution, the split lives in CSM. The distribution message includes optional donorAllocations and donorSplitRevision. After submission local changes are blocked. After HS inbox approval, editing from either portal updates HS through the existing secret-protected HOPE_ADMIN service binding. The original donor details remain on the source payment for reconciliation. Both implementations of csm-distribution-contract.ts and donation-allocation.ts must stay identical.

Giving letters replace the original payer with allocations and use original gift dates, including gifts made before the combined deposit year. HS-approved transfers are read from HS, even if the approval callback is delayed. Failed authoritative reads block letter generation rather than silently crediting the original payer. Allocations do not inherit the transfer agent's mailing address. Fill in donor addresses in the appropriate contact profile when needed. Payment dashboards and bank exports remain reports of original payment activity.

Deployment: apply HS migration 0024 and deploy HS Worker first; apply CSM migration 0003 and deploy CSM Worker/admin assets next; publish HS finance assets. No LEDGER_DB migration is required. Existing payment rows are not rewritten. Rollback should preserve allocation tables and return both codebases together to compatible versions; exporting donor statements with old code would lose allocation attribution.

Validation: npm run check and npm test; test exact totals, fees, original gift years, undo, stale saves, transferred edits, delayed callbacks, and unavailable HS data. Never use production donor mutations as a smoke test.
