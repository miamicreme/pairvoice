# Handoff: P0 payout and privacy fixes (27 Nov 2026)

**For:** ChatGPT (or any reviewer/engineer) continuing PairVoice release work.
**Repo:** `miamicreme/PairVoice` · **Base:** `main` @ `17fbd00079b37001dc4817660aa0093f1f6dfa15`
**Branch:** `fix/p0-payout-privacy-20261127` (one commit on top of base)
**Context:** closes the four P0 code defects and the production env gap from the independent review (dossier V6, Section 23). Finding IDs (CR-xx) match that review.

## 1. What changed

| ID | Problem (before) | Fix | Files |
|---|---|---|---|
| CR-04 | `POST /api/lead` returned `{...result}` from the edge function, which includes `referrerEmail`, `referrerFirstName`, `referrerLanguage`. Anyone signing up with a referral code got the referrer's email. | Response now built from an explicit allowlist (`inviteCode`, `languageCode`, `partnerJoined`, `inviteUrl`, `emailStatus`, `phoneCaptured`). Referrer fields are still used server-side to send the "partner joined" email. | `lib/lead-response.ts` (new), `app/api/lead/route.ts` |
| CR-02 | `POST /api/payout-method` stores the recipient encrypted (`v1:iv:tag:data`), but the payout worker sent that ciphertext to PayPal as `receiver`. Every PayPal payout would fail. | Worker decrypts server-side, normalizes and validates the email, fails closed on bad ciphertext / wrong key / non-email. Legacy plaintext emails still accepted if valid. | `lib/payout-recipient.ts` (new), `app/api/internal/payouts/route.ts` |
| CR-01 | Methods are inserted with `is_default=false`; admin PATCH only changed `status`; nothing ever set `is_default=true`, but `request_participant_payout` requires a VERIFIED default. No payout could ever be requested. | New RPC `set_payout_method_status` (migration 0041): locks the participant, verifies/disables, keeps exactly one default (newest verified wins; disabling the default promotes the most recent other verified method), writes the audit event, all in one transaction. Admin PATCH now calls it. Backfill gives existing participants with verified methods but no default their newest verified method. | `supabase/migrations/0041_payout_default_and_submit_claim.sql` (new), `app/api/admin/payout-methods/route.ts` |
| CR-03 | Worker ignored the error on the DB update that stores PayPal's batch ID. On a lost write the next run resubmitted, PayPal rejected the duplicate `sender_batch_id`, and the catch marked an already-paid attempt FAILED. Any post-PayPal error was also marked FAILED. No claim against concurrent workers. | (a) New column `provider_payout_attempts.submit_claimed_at`; each attempt is claimed with a single conditional UPDATE before any PayPal call, so only one worker wins and a claimed attempt is never auto-resubmitted. (b) Outcomes split: validation errors before PayPal → FAILED; definitive PayPal 4xx → FAILED; 5xx / 429 / network / duplicate-batch / unparseable → UNKNOWN (reconcile first); missing credentials or OAuth failure → claim released, retried next run. (c) After PayPal accepts, nothing can mark the attempt FAILED; a missing batch ID → UNKNOWN; a failed save logs `PAYOUT_RECONCILIATION_REQUIRED` with the batch ID and keeps the claim. | `lib/paypal-outcome.ts` (new), `app/api/internal/payouts/route.ts`, migration 0041 |
| Env | Production service in `render.yaml` did not declare `PAIRVOICE_EDGE_SHARED_SECRET` (signup returns 503 "Account signup is not configured") or `PAIRVOICE_CREDENTIAL_ENCRYPTION_KEY` (payout methods cannot be saved or decrypted). | Both declared on the production service (`sync: false`, values set in Render, never in git). | `render.yaml` |

Worker response now reports `{processed, submitted, failed, uncertain, retry, skipped}`.

## 2. Verification performed (27 Nov 2026)

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` (vitest) | 30/30 pass, incl. 14 new tests: `lib/lead-response.test.ts`, `lib/payout-recipient.test.ts`, `lib/paypal-outcome.test.ts` |
| `npm run build` | Pass |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| All migrations 0001→0041 applied from zero on local PostgreSQL 16 (Supabase auth/roles stubbed) | Pass |
| All 24 files in `supabase/tests/*.sql`, incl. new `payout_default_method_invariants.sql` | 24/24 pass |
| 0041 backfill on simulated pre-0041 data; 0041 re-run | Newest verified method becomes default; re-run is a no-op |

**Not verified:** no PayPal sandbox call, no Render deploy, no live/staging database, no browser E2E. The API routes themselves (Next.js handlers) are covered by typecheck and build only; their logic lives in the tested `lib/` helpers and the tested SQL RPC.

## 3. Deploy steps (owner)

1. In Render → production service → Environment: set `PAIRVOICE_EDGE_SHARED_SECRET` (same value as the Supabase edge function secret) and `PAIRVOICE_CREDENTIAL_ENCRYPTION_KEY` (32 random bytes, base64). **The encryption key must be the same key used by any environment that already wrote payout methods or credential bundles to this database**, or existing rows become undecryptable.
2. Confirm both Render services deploy from `miamicreme/PairVoice` (not the archived `Kohronburton/PairVoice`).
3. Apply migration `0041` to staging, run `supabase/tests/payout_default_method_invariants.sql`, then production. Additive only; do **not** reset or re-run `0001_baseline.sql`.
4. Merge the branch to `main` (production) and `phase-2-production-workflow` (staging).
5. Staging smoke: sign up with a referral code → response has no `referrer*` fields; add PayPal method → admin verifies → `is_default=true`; request payout → worker with `PAYPAL_MODE=sandbox` → attempt gets `provider_reference`, webhook marks PAID.
6. Keep `PAYOUT` subsystem paused in production until step 5 passes.

## 4. Ops query: attempts needing manual reconciliation

```sql
select id, payout_id, state, submit_claimed_at, last_error, result_metadata
from provider_payout_attempts
where (state='PROCESSING' and provider_reference is null and submit_claimed_at < now() - interval '15 minutes')
   or state in ('UNKNOWN','MANUAL_REVIEW')
order by created_at;
```
Check each against PayPal (search by `sender_batch_id = 'pairvoice-<attempt id>'`), then resolve with `reconcile_payout_attempt(...)` as SUCCEEDED (with batch ID) or FAILED. Never create a new attempt for a payout until its current attempt is resolved.

## 5. Remaining work (not in this change)

| Priority | Item | Notes |
|---|---|---|
| P1 | CR-17 health check | `/api/health` checks env presence only and hard-codes `environment:'production'`. Add a bounded DB probe and real environment/commit identity. |
| P1 | CR-07 partner lookup | `app/api/existing-partner/route.ts` uses `.ilike('email', input)`; `%`/`_` act as wildcards. Use exact match on normalized email (`.eq`), rate-limit, uniform responses. |
| P1 | CR-12 wallet totals | `app/wallet/page.tsx` sums last 20 ledger / 10 payout rows, first currency only. Replace with SQL aggregates per currency. |
| P1 | CR-18 work access | `app/api/work/access/route.ts` returns `pairState:'READY'` as a constant. Return the real pair state. |
| P1 | Reviewer items CR-06/08/09/10/22 | HTML escaping, GET mutation, account enumeration, public rate limits, URL schemes: re-check against current code. |
| P1 | Stuck-claim alerting | Surface the §4 query in admin readiness/metrics. |
| P1 | Signup edge function response | `app/api/signup/route.ts` spreads the edge response (`{...data}`); currently returns only the user's own codes, but apply the same allowlist pattern as CR-04 for defense in depth. |
| P0 (business) | Buyer capacity, provider account terms, payout reserve, tax forms | See dossier Section 19 and 23. Code is not the bottleneck after this change. |

## 6. Prompt for ChatGPT

> You are continuing PairVoice release work. Read `docs/HANDOFF_P0_PAYOUT_PRIVACY_FIXES.md` on branch `fix/p0-payout-privacy-20261127` of `github.com/miamicreme/PairVoice` (or the attached copy). (1) Independently review the diff against base `17fbd000` for correctness, security and regressions; list any defect with file and line. (2) Then implement the P1 items in Section 5 in the same style: smallest safe change, a unit or SQL test for each, no secrets, no changes to applied migrations (add new numbered migrations only). (3) Report what you verified and what you could not. Do not mark anything production-ready without the staging smoke test in Section 3.
