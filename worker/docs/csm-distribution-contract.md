# CSM distribution contract

Version 1 makes Christian Steps Ministries (CSM) the source of record for PayPal activity while each ministry remains responsible for approving its own donor and accounting records.

## Eligible transactions

CSM may distribute a transaction only when all of these conditions are true:

- The assigned product is `HopeSojourns` or `JoshBeyondBorders`.
- The PayPal event code begins with `T00` (a payment event).
- The normalized PayPal status is `Completed` and the currency is USD.
- A received transaction has a positive gross amount.
- A sent transaction has a negative gross amount.

Balance holds, hold releases, transfers, currency conversions, fees reported as standalone events, and other non-payment events are never distributed. This eligibility rule is enforced by the CSM API, the recipient consumer, and the user interface.

## Message identity and revisions

- `schemaVersion` is currently `1`.
- `messageId` identifies one delivery attempt record and is globally unique.
- `idempotencyKey` identifies the destination, source PayPal transaction, source event code, and source revision. Recipients enforce it with a unique database constraint.
- `sourceRevision` starts at `1`. A corrected source record must use a new revision instead of altering an already approved recipient ledger entry in place.

Repeated delivery attempts are expected and safe. A recipient returns the previously recorded status without creating a second donor or financial transaction.

## Display Name and party data

Every message includes a non-empty `displayName` and the same value in `party.displayName`.

- For received gifts, `party.role` is `donor` and `masterDonorId` is required.
- For sent payments, `party.role` is `payee` and `masterDonorId` must be null. Sent transactions never create donor records.

The message contains only the donor or payee snapshot needed for review: name, email, phone, postal address, product, transaction identifiers, date, item information, and amounts. Raw PayPal responses remain in CSM and are not distributed.

## Recipient matching

Recipients match received gifts in this order:

1. An existing CSM master-donor link.
2. One unique exact normalized email match.
3. Manual review.

Names alone are never used for automatic matching. No match is a proposed new donor. Multiple email matches require the recipient administrator to select or create a donor.

## Review statuses

- `pending`: ready for recipient review.
- `needs_match`: the received gift needs a donor decision or missing required donor details.
- `approved`: committed to the recipient ledger.
- `denied`: intentionally declined with a required reason.
- `failed`: processing failed and may be retried.

CSM records `queued` before its private delivery attempt, then uses the recipient's returned state. Recipient status callbacks continue to update CSM's outbox view after review.

## Approval transaction

Recipient approval is atomic. For a received gift it creates or confirms the donor link, creates the financial ledger record, records the audit event, and marks the inbox message approved in one database transaction. For a sent payment it creates a financial ledger record without a donor. If any step fails, none of the approval steps are committed.

## Cutover rule

Legacy PayPal ingestion remains available during shadow mode. A destination can stop using its legacy transaction ingestion only after a reconciliation compares counts and gross, fee, and net totals by direction and product and finds no unexplained differences. Public donation checkout and PayPal webhook functions are independent of transaction ingestion and remain active.
