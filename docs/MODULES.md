# ERP Modules (audit V2)

## 1. Finance
General Ledger (chart of accounts, journals post/reverse, balanced double-entry enforced), financial periods + period-lock, trial balance, ledger, P&L, balance sheet, cash flow, VAT report, multi-currency + FX, AR/AP ageing, bank accounts, bank transfers, checks (sequence, print, void, allocation), credit-card register, bank reconciliation (server-side), budgets + budget-vs-actual, budget control + approval.

## 2. Procurement
Suppliers, purchase requisitions (submit/approve/reject/convert), purchase orders (partial receive: ordered/received/invoiced/remaining), goods-received notes → stock + batch/serial, supplier invoices (Dr expense/inventory, Cr AP) with 3-way match + duplicate-bill prevention, supplier payments (Dr AP, Cr bank) clearing AP, vendor credits + applications.

## 3. Sales
Customers, quotations → sales orders → invoices (Dr AR, Cr Revenue+VAT), deliveries + dispatch (inventory issue + COGS), receipts (Dr cash, Cr AR; PART_PAID/PAID), credit notes (reversal) and debit notes (Dr AR/Cr Revenue+VAT), statements, debtor ageing, sales register, fiscal-ready workflow.

## 4. Inventory
Items, warehouses, movements (RECEIPT/ISSUE), real COGS (Dr Cost of Sales, Cr Inventory), weighted-average costing, batches + serials, stock counts, on-hand aggregation.

## 5. HR & Payroll
Employees, departments, attendance, leave policies + accrual + balances, recruitment (vacancies/candidates/applications/interviews/offers), onboarding, benefits, payroll runs + payslips, effective-dated statutory rules (verified-required; `NOT_CONFIGURED` blocks finalisation — never invented rates).

## 6. CRM
Leads, opportunities (pipeline) with quote-from-opportunity, interactions, tasks, service tickets/complaints with SLA, customer history.

## 7. Assets & Maintenance
Asset register, categories (GL mapping: asset/acc-dep/dep-expense/gain-loss), locations + history, depreciation runs (GL posted: Dr dep expense/Cr acc-dep), disposal with gain/loss, maintenance orders.

## 8. Compliance & Risk
Risk register + 5×5 matrix, internal controls + tests + evidence, audit engagements/procedures/findings/actions, statutory rules, regulatory reports, compliance calendar + reminders, exception reporting.

## 9. Projects & Costing
Projects/tasks/notes/attachments, timesheets + labour costing, real profitability (material/labour/other) + budget variance.

## 10. BI & Reporting
Dashboard metrics, Sales by Month, Purchases, Debtor Ageing, Stock Valuation, Expense Analysis (by account/vendor/project), controlled Report Builder (datasets + run + CSV + saved reports), finance reports.

## 11. Administration & Security
Users, roles/permissions (RBAC, 15 seeded roles), permissions guard, approvals engine, audit logs, branches/departments, platform admin, structured config, configurable document numbering, scheduled jobs (DB-backed), database backup/restore (pg_dump/pg_restore, encryption, retention, platform-guarded restore), MFA + password reset + email verification + refresh-token rotation.

## 12. Fiscalisation
Fiscal devices (register + cert + open/close day), server-side atomic daily/global counters, invoices/credit notes/debit notes → signed payload → mock FDMS, persisted retry queue + job abstraction, integration logs, provider abstraction (mock/test/prod — prod stubs throw until credentialed), UAT-ready.

## 13. Integrations / Platform SaaS
Payment / object-store / message / queue adapters (safe mock + credentialed prod stubs), usage metering + billing (MRR/plan), integration registry (ZIMRA, Paynow, SMTP, Bank, Webhook, SSO, Storage, WhatsApp), tenant/company/subscription platform admin, observability (`/health/ready`, `/system/metrics`).
