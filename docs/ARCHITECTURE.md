# Architecture

## Tenant hierarchy

Subscriber/Tenant -> Legal Company -> Branch -> Department/Warehouse/POS -> Fiscal Device.

Every business transaction is scoped server-side by tenant and company context derived from the authenticated JWT. Fiscal device identities and keys belong to a specific legal company/branch and must never be shared between tenants.

## Application topology

Browser -> Next.js web -> NestJS API -> PostgreSQL

NestJS modules contain business rules. Next.js contains presentation only. External systems integrate with the API, not the browser.

## Core design principles

- API-first and multi-tenant from day one.
- Double-entry posting engine is the accounting source of truth.
- Immutable posted journals; reversals instead of destructive editing.
- Inventory movements are append-only business events.
- Fiscalisation is isolated behind a provider interface.
- ZIMRA counters are allocated on the server inside a database transaction.
- Effective-dated tax/statutory rules instead of hard-coded permanent rates.
- Platform subscriptions and feature entitlements are separate from company RBAC.
- Audit events are written for sensitive actions.

## Production decomposition

Start as a modular NestJS monolith. Extract high-load units later if required: fiscal workers, report workers, notification workers, integration gateway.
