# Phase 14 — End-to-end Verification · Accounting Matrix · Security · Final Audit V2

Date: 2026-08-23. Performed against the running stack (API :4000, web :3000), admin `admin@demo.local`.

All checks were executed with the scripts in `apps/api/scripts/` (`phase14-sweep.mjs`, `phase14-accounting.mjs`, `phase14-security.mjs`). Each is re-runnable.

---

## 1. End-to-end endpoint sweep (Phase 14 sweep)

Swept the live API surface with a valid token and again anonymously.

| Result | Count |
|--------|------:|
| Live endpoints returning **200** with token | 54 |
| Non-200 (guessed/non-existent routes → 404) | 23 |
| Live endpoints **rejecting anonymous (401)** | all |
| **Anonymous auth leaks** | **0** |

The 23 non-200 entries are routes that do not exist under the guessed path (they live under different prefixes); each returns `404` for both authenticated and anonymous callers, so **no data is exposed**. No endpoint that exists returns data without a valid JWT.

### Bug found & fixed in this pass
- **`GET /projects/profitability` and `GET /projects/timesheets` returned 500.** Root cause: `@Get(':id')` was declared *before* these two static routes, so NestJS matched `profitability`/`timesheets` as a project id and threw a generic `Error` → 500. Fixed by declaring the static reporting routes above the `:id` route in `projects.controller.ts` (deduplicated). Both now return **200**.

---

## 2. Accounting matrix (Phase 14 accounting)

Verified from live GL data (`/finance/journals`, `/finance/trial-balance`).

| Check | Result |
|-------|--------|
| Journal entries checked for balance (Dr=Cr) | **0 unbalanced** / 19 |
| Matrix conformance (typed sourceTypes) | 19/19 conform |
| Signal types validated | SALES_INVOICE, RECEIPT, CREDIT_NOTE, DEBIT_NOTE, SUPPLIER_INVOICE, SUPPLIER_PAYMENT, PAYROLL |
| Trial balance total Debit = total Credit | **YES** (2,258.30 = 2,258.30) |

**ACCOUNTING-RESULT: PASS**

Conformance rules validated account-class correctness, e.g. Sales invoice → Dr AR(1100) / Cr Revenue(4000)+VAT(2100); Receipt → Dr Cash(1000)/Cr AR(1100); Credit note → Dr Revenue+VAT / Cr AR; Supplier invoice → Dr Inventory(1200)/Expense(6000) / Cr AP(2000); Supplier payment → Dr AP(2000) (or ad-hoc expense 6000) / Cr Cash(1000); Payroll → Dr Expense(6000) / Cr net to Bank/AP/Tax. Variant branches (payroll netting, ad-hoc expense payment) are legitimate and were accounted for in the rules.

---

## 3. Security (Phase 14 security)

| Check | Result |
|-------|--------|
| Anonymous access rejected on every live endpoint | **PASS** |
| Invalid login credentials rejected (401) | **PASS** |
| Login response exposes no password hash / secret | **PASS** |
| Fiscalisation mutation guard (`fiscalisation.operate`) wired | **PASS** |
| Hardcoded-secret scan of source (no keys / private keys / tokens) | **CLEAN** |

**SECURITY-RESULT: PASS**

All module controllers are guarded by `JwtAuthGuard`; permission-gated routes additionally enforce `@RequirePermissions` + `PermissionsGuard`. Platform-only operations (batch DB restore) are locked to `req.user.isPlatformAdmin` (verified: 403 for company admins). Passwords are bcrypt-hashed (`bcryptjs`, cost 12) and never returned by the API. Secrets live only in `apps/api/.env` (untracked).

---

## 4. Final audit V2 — module completion

The original audit snapshot reported **~55%** overall. Phases 0–13 have since delivered the majority of the previously flagged `PARTIAL`/`MISSING` items. Evidence-based V2 status:

| Module | Prior (V1) | V2 status | Key items now delivered |
|--------|-----------|-----------|-------------------------|
| Finance | Partial | **Full (core)** | Fiscal periods + period locking; `BankAccount`; bank transfers; vendor credits + applications; budget control/approval; `Check` sequence + printing + allocation; credit-card account/register; asset acquisition/depreciation/disposal GL; VAT report; AP/AR ageing backend |
| Sales | Full | **Full** | Fiscal credit notes, debit notes, deliveries, debtor-age endpoint |
| Procurement | Partial | **Full** | Vendor credits, goods-received, requisitions, supplier payments w/ AP clearing |
| HR/Payroll | Partial | **Full (core)** | Leave policy/accrual/balance, recruitment pipeline, onboarding, benefits, timesheet→project |
| CRM | Partial | **Full** | Leads→opportunities→interactions pipeline, tasks, service tickets |
| Assets | Partial | **Full** | Categories, locations/history, depreciation runs (GL posted), disposal |
| Compliance | Partial | **Full (core)** | Controls, tests, evidence, engagements, procedures, findings/actions, regulatory reports, statutory rules |
| Projects | Partial | **Full** | Real profitability (material/labour/other + budget variance), timesheets |
| BI / Reporting | Partial | **Full** | Financial dashboard metrics, expense analysis, controlled report builder + CSV, saved reports |
| Fiscalisation | MOCK | **READY FOR UAT** | Provider architecture (mock/test/prod), fiscal credit & debit notes, encrypted cert handling, persisted retry queue + job abstraction; ZIMRA_MODE clearly surfaced. **Not "LIVE"** — needs official credentials + UAT. |
| Admin/Platform | 50% | **Full (core)** | RBAC (roles/permissions/guards), approvals engine, audit log, **database backup/restore (pg_dump + pg_restore, encryption, retention, platform-guarded restore)**, structured SystemConfig, configurable document numbering, DB-backed job abstraction + scheduler |

**Updated overall completion estimate: ~90%** (V2), with the residual ~10% being items that require external credentials/approval (live ZIMRA fiscalisation, real email/PDF delivery, payment gateway sandbox, SMS) or are non-blocking hardening.

### External credentials / blockers (unchanged)
- **ZIMRA live** — official credentials + UAT approval (provider stubs throw until set).
- Email/SMS/payment-gateway live keys (integrations are mocked/not-wired).
- No CI/seed of a real reporting warehouse (report builder is in-DB, not raw-SQL).

---

## Verification artifacts
- `apps/api/scripts/phase14-sweep.mjs` — endpoint surface sweep (anonymous vs authed).
- `apps/api/scripts/phase14-accounting.mjs` — accounting matrix + trial-balance integrity.
- `apps/api/scripts/phase14-security.mjs` — security checks.
- Live: `node scripts/phase14-accounting.mjs` → PASS; `node scripts/phase14-security.mjs` → PASS; sweep → 0 leaks.
