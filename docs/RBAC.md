# NexusERP RBAC

## Models (Prisma, company-scoped)
- `Permission` — global stable codes (`code` unique, `name`, `module`).
- `Role` — per company (`@@unique([companyId, name])`, `isSystem`).
- `RolePermission` — role↔permission (`@@unique([roleId, permissionId])`).
- `MembershipRole` — user membership↔role (`@@unique([membershipId, roleId])`).

## Permissions
Defined in `apps/api/src/modules/auth/permissions.ts` (`PERMISSIONS`). Codes use `module.action` (e.g. `finance.journals.reverse`, `inventory.adjust`, `payroll.process`, `fiscalisation.operate`, `admin.users.manage`).

## Default roles
`ROLE_DEFS` seeds 15 roles per company (Company Administrator → full; Read Only → view/export only; plus Finance/AP/AR/Procurement/Sales/Inventory/HR/Payroll/Auditor). Wildcards (`module.*`, `finance.*`) expand to concrete codes via `expandPerms`.

## Backend
- `PermissionService`: `ensurePermissions()` (seed), `ensureCompanyRoles(companyId)` (seed roles+permissions), `getPermissions(user)` / `getRoleNames(user)`, `hasAny(user, required)`, `assignRoleToMembership`.
- `@RequirePermissions(...)` decorator (any-of semantics) + `PermissionsGuard` (runs after `JwtAuthGuard`; verifies authenticated + company membership + required permission).
- Applied to: `finance.journals.reverse`, `payroll.process`, and fiscalisation (operate vs view).
- Modules using the guard import `AuthModule`.

## Frontend
- `components/Can.tsx`: `useAuthPermissions()` (fetches `GET /auth/permissions`, 60s cache) and `<Can permission="...">` (renders children only if permitted; supports array = any-of). Backend remains authoritative.

## Enforcement
Backend is authoritative. Frontend `<Can>` only hides UI. Cross-token access prevented because each controller filters by `companyIdOf(req.user)` + Prisma `companyId`.

## To extend
Apply `@RequirePermissions` to additional sensitive endpoints (admin users/roles, budgets, procurement approvals, asset dispose, vendor credits, check/credit-card, journal reversal audit). Documented as remaining work.
