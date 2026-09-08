# Feature Matrix (audit V2)

Legend: **Full** = complete end-to-end workflow (UI → API → validation → service → DB → accounting/reporting); **Core** = primary flow complete, ancillary hardening remains; **UAT-ready** = mock-satisfiable and wired for live credentials; **External** = requires live credentials/infrastructure.

| Area | Status | Delivered (V2) |
|---|---|---|
| Multi-tenancy | Full | Tenant/company/branch hierarchy; company-scoped JWT context; platform-admin API |
| Platform admin | Full | Tenants, plans, onboarding, tenant/subscription; platform-guarded DB restore |
| Authentication | Full | JWT login + refresh-token rotation; company switch; platform admin; logout revocation |
| RBAC | Full | Role/Permission/RolePermission/MembershipRole; `@RequirePermissions` + `PermissionsGuard`; `/auth/permissions`; `Can` component; 15 seeded roles |
| MFA / security | Full | RFC 6238 TOTP (`setup/verify/disable`), password reset, email verification; all sessions revocable |
| Finance / GL | Full | Chart of accounts, double-entry posting, journals (post/reverse), periods + period-lock, trial balance, ledger, P&L, balance sheet, cashflow, VAT report, multi-currency + FX |
| Accounts Receivable | Full | Customers, posted invoices, receipts (Dr cash/Cr AR) with PART_PAID/PAID, credit notes + **debit notes**, statements, debtor ageing |
| Accounts Payable | Full | Suppliers, supplier invoices (Dr expense/inventory/Cr AP), vendor credits + applications, supplier payments (Dr AP/Cr bank), AP ageing |
| Cash & Bank | Full | Cash/bank GL, **BankAccount**, bank transfers, `Check` sequence + printing/void, credit-card register, bank reconciliation (server-side) |
| Budgeting | Full | Budgets + lines, budget-vs-actual, **budget control** rules + approval + warning/block |
| Sales | Full | Quotations → sales orders → invoices → deliveries (dispatch → inventory issue + COGS), receipts, register, fiscal-ready |
| Credit/debit notes | Full | Full UI + posting reversal (Dr rev+VAT / Cr AR) and debit note (Dr AR / Cr rev+VAT); fiscal credit/debit notes |
| Procurement | Full | Suppliers, requisitions (submit/approve), POs (partial receive), GRN → stock + batch/serial, supplier invoices (3-way match, duplicate prevention) |
| Inventory | Full | Items, warehouses, movements, on-hand aggregation, real COGS (Dr COGS/Cr Inventory), batches + serials, stock counts, weighted-average costing |
| HR | Full | Employees/departments, attendance, leave policies + accrual + balances, employee lifecycle |
| Payroll | Full | Payroll runs, payslips, effective-dated statutory rules (no invented rates — `NOT_CONFIGURED` blocks finalisation), leave/attendance → payroll |
| Recruitment & onboarding | Full | Vacancies, candidates, applications, interviews, offers, onboarding templates/tasks |
| Benefits | Full | Benefit plans + employee benefits |
| CRM | Full | Leads → opportunities (pipeline) → interactions, tasks, service tickets/complaints, quote-from-opportunity |
| Assets | Full | Register, categories (GL mapping), locations/history, depreciation runs (GL posted), disposal with gain/loss |
| Maintenance | Core | Asset maintenance orders/workflow |
| Compliance & risk | Full | Risk register + 5×5 matrix, internal controls + tests + evidence, audit engagements/procedures/findings/actions, statutory rules, regulatory reports, exceptions, reminders |
| Projects | Full | Projects/tasks/notes/attachments, timesheets + labour, real profitability (material/labour/other + budget variance) |
| Reporting / BI | Full | Dashboard metrics, Sales by Month, Purchases, Debtor Ageing, Stock Valuation, **Expense Analysis**, **controlled Report Builder** (datasets + run + CSV + saved reports), financial reports |
| Audit trail | Full | `AuditLog` on mutations + audit retention job (`AUDIT_PRUNE`) |
| Approvals | Full | Approval workflow/steps/requests/actions; My Approvals (submit/approve/reject); permissions |
| System config | Full | Structured preferences, configurable document numbering (`{prefix}/{year}/{seq}` + zero-pad) |
| Scheduled jobs | Full | DB-backed job abstraction + scheduler (backup, fiscal retry, compliance reminders, audit prune) |
| Backup / restore | Full | `pg_dump` (custom format), optional AES-256-GCM, retention, download, **platform-guarded** `pg_restore` |
| Fiscal devices | Working mock | Device registration + cert + open/close day + unified/daily/global atomic counters |
| Fiscal fiscalisation | UAT-ready | Invoices/credit notes/debit notes → signed payload → mock FDMS; retry queue; **Test/Production stubs throw until credentialed** |
| ZIMRA live adapter | External | Intentionally blocked pending official UAT/certification + credentials |
| Integration adapters | UAT-ready | Payment / object-store / message / queue adapters (safe mock + credentialed prod stubs); usage metering + billing |
| Integration registry | Working | ZIMRA, Paynow, SMTP, Bank, Webhook, SSO, Storage, WhatsApp placeholders/statuses |
| Background queues | Core | In-process queue adapter; Redis/BullMQ adapter ready (activation = production roadmap) |
| Subscription billing | Core | Plans/subscriptions + usage metering + MRR; live payment gateway = external |
| Observability | Core | `/health/ready`, `/system/metrics`, structured logs, DR runbook |
