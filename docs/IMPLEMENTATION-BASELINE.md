# NexusERP Implementation — Baseline (Phase 0)

Baseline recorded before large schema changes.

## Build status
- `prisma validate` — PASS (schema valid)
- `prisma generate` — PASS
- `apps/api` build (`nest build`) — PASS
- `apps/web` build (`npm run build`) — PASS
- Runtime: API `http://localhost:4000/api`, Web `http://localhost:3000`.

## Database schema
PostgreSQL «nexuserp». Models present (pre-RBAC): Tenant, Company, Branch, Department, User, Membership, SubscriptionPlan, Subscription, LedgerAccount, JournalEntry, JournalLine, SalesInvoice(_Line), PurchaseOrder(_Line), InventoryItem, Warehouse, StockMovement, Employee, StatutoryRule, Lead, Asset, Risk, ComplianceObligation, FiscalDevice, FiscalDay, FiscalReceipt, FiscalIntegrationLog, AuditLog, IntegrationConnection, Quotation(_Line), SalesOrder(_Line), Receipt, CreditNote(_Line), PurchaseRequisition(_Line), GoodsReceivedNote(_Line), SupplierInvoice(_Line), SupplierPayment, StockCount(_Line), LeaveRequest, Attendance, PayrollRun, Payslip, Opportunity, CrmTask, CustomerInteraction, MaintenanceOrder, TaxRate, Budget, SystemConfig, Project, ProjectTask, ProjectNote, ProjectAttachment.

Enums: UserStatus, InvoiceStatus, FiscalStatus, FiscalDayStatus, DeviceStatus, JournalStatus, AccountType, StockMovementType, PurchaseOrderStatus, LeadStatus, AssetStatus, RiskStatus, IntegrationType.

## Existing modules/APIs (high-level)
- Auth (login/me/switch-company), Admin (users/branches/departments/audit-logs/config), Company, Dashboard, Sales, Finance (accounts/journals/trial-balance/profit-loss/balance-sheet/cashflow/budget-vs-actual + PostingService), Inventory, Procurement, Hr, Crm, Assets, Compliance, Fiscalisation (MOCK), Integrations, Platform, Projects.
- Accounting posting engine: `PostingService` (sales invoice, receipt, credit note, supplier invoice, supplier payment, payroll, manual journal).

## RBAC added in this phase (Phase 1)
- Models: `Permission`, `Role`, `RolePermission`, `MembershipRole`.
- `PermissionService` (seeds permissions + per-company default roles, resolves a user's permissions/roles).
- `@RequirePermissions(...)` + `PermissionsGuard` + `CurrentUser`.
- `GET /auth/permissions` (returns `{ permissions, roles }`).
- Default roles seeded: Company Administrator (full), Finance Manager, Accountant, AP Clerk, AR Clerk, Procurement Manager, Procurement Officer, Sales Manager, Sales Clerk, Inventory Manager, Warehouse Clerk, HR Manager, Payroll Officer, Auditor, Read Only.
- Guards applied to sensitive endpoints: `finance.journals.reverse`, `payroll.process`, fiscalisation operate/view.
- Frontend: `components/Can.tsx` (`<Can permission="...">`, `useAuthPermissions()`).

## Working (FULL) functionality preserved
All modules audited as FULL in `docs/NEXUSERP_FULL_IMPLEMENTATION_AUDIT.md` remain unchanged/working. No working feature was modified except adding RBAC guards to three sensitive endpoints (behind existing JWT auth).
