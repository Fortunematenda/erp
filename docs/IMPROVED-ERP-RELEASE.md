# NexusERP Improved Release

This release consolidates the existing ERP into a more consistent modern workspace rather than replacing working modules.

## Key improvements in this release

### 1. Cross-module Action Centre
The header notification bell now opens a live action centre. It aggregates:
- overdue customer invoices;
- pending approvals;
- failed/retry fiscal receipts;
- low-stock products based on stock movements and reorder levels;
- quotations expiring within seven days; and
- unread performance/KPI notifications.

API: `GET /api/workspace/action-center`

### 2. Global record search
The header search now searches both pages and business records:
- customers;
- suppliers;
- products/items;
- invoices;
- quotations;
- sales orders; and
- employees.

Use **Ctrl/Cmd + K** from anywhere in the ERP to focus search.

API: `GET /api/workspace/search?q=...`

### 3. Quick Create
A consistent Create menu was added to the top bar for the most common documents and master records.

### 4. Sales master-data consistency
The project already contained a central PricingService and customer document-default path. This release preserves and standardises that architecture:
- blank customer display names auto-resolve server-side;
- customer billing address, email, phone, terms, tax defaults and price list have one shared hydration path;
- sales Rate resolves from customer price list first, then product default selling price;
- cost price is never silently used as the sales price;
- quote/order/invoice totals are recomputed server-side.

### 5. Packaging and security hygiene
- production/local `.env` files are excluded from the improved ZIP;
- database dumps, build output, `.git`, `.next`, `dist` and `node_modules` are not packaged;
- `.gitignore` was repaired and simplified;
- `.env.example` files remain as configuration templates.

## Recommended next implementation wave

1. Move all remaining document-specific status strings to typed lifecycle policies.
2. Add action-level RBAC checks to frontend command buttons in addition to API guards.
3. Add persisted user table views (filters, columns, density, saved views).
4. Add a generic workflow orchestration layer for quote, procurement, leave and payment approvals.
5. Add job queue infrastructure for fiscalisation, PDF generation, WhatsApp/email and long reports.
6. Add automated integration tests for Quote → Order → Delivery → Invoice → Receipt → GL/Fiscalisation.

## Local setup

Use the existing Windows setup scripts or run:

```bash
npm install
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

Copy the provided `.env.example` templates to local `.env` files and configure your PostgreSQL/JWT/ZIMRA/SMTP values locally. Never commit real credentials.
