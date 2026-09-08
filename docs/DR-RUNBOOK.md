# Disaster Recovery & Operations Runbook (Phase 15)

Covers the production-readiness concerns surfaced by the audit and implemented/operationalised in Phase 15: **observability**, **database backup / PITR-capable recovery**, and **DR drill** procedures.

---

## 1. Health & readiness

| Probe | Endpoint | Purpose |
|-------|----------|---------|
| Liveness | `GET /api/health` | Service is up (returns `ok:true`, timestamp). |
| Readiness | `GET /api/health/ready` | Checks Postgres connectivity (`SELECT 1`) and returns DB status + counts (`users`, `journals`, `backups`). |

Readiness returns `ok:false, db:"down"` if the database is unreachable — use it in your orchestrator (Kubernetes/K8s `readinessProbe`, Docker Compose healthcheck) to gate traffic.

## 2. Metrics / observability

`GET /api/system/metrics` (JWT-guarded, admin) returns live counters: `users, companies, journals, invoices, receipts, auditLogs, backups, jobs`.

Structured runtime logs are emitted by NestJS (request logs, `Scheduler`, `ExceptionsHandler`). Audit trail is persisted in `AuditLog` and retains `AUDIT_RETENTION` days (default 365) — the `AUDIT_PRUNE` scheduled job deletes older rows daily (see Administration → Data & Jobs).

## 3. Backups

Backups are created with **`pg_dump` (custom format)** and stored under `BACKUP_DIR` (default `storage/backups`).

- **Create**: `POST /api/system/backups` (auth; also run automatically by the `BACKUP` scheduled job daily).
- **Encryption**: if `BACKUP_ENCRYPTION_KEY` (or `ENCRYPTION_KEY`) is set, the dump is encrypted with AES-256-GCM (key derived via SHA-256). `encrypted` is recorded per backup; encryption happens **before** the file is written at rest.
- **Retention**: `BACKUP_RETENTION` (default 10) keeps the latest N completed backups; older are marked `EXPIRED` and their files removed.
- **Download**: `GET /api/system/backups/:id/download`.

## 4. Point-in-time recovery (PITR)

The custom-format `pg_dump` file plus Postgres write-ahead logs (WAL) enables point-in-time recovery. **To enable PITR**, configure the Postgres instance with continuous WAL archiving and keep the archived WAL matching the backup timeline. A full base backup (this app's `pg_dump`) is the anchor; recovery = restore the base backup then replay WAL up to the target time.

## 5. Restore

**Guarded to platform administrators** (company admins receive 403).

1. `POST /api/system/backups/:id/restore`
2. The service first takes a **safety snapshot** of the current state, then runs `pg_restore --clean --if-exists --no-owner --no-privileges --dbname=<DATABASE_URL> <backup-file>`.
3. Verify: `GET /api/health/ready` (counts), then run `apps/api/scripts/phase14-accounting.mjs` to confirm the trial balance still balances.

> Restore is destructive — only platform admins may run it, and a safety snapshot is always taken first.

## 6. DR drill checklist

1. Confirm `GET /api/health/ready` → `db:"up"`.
2. Shut down the API, take a cold offline backup (`pg_dump`).
3. Simulate failure: stop Postgres, note the outage; verify readiness probe reports `db:"down"`.
4. Restore the database from the last backup (see §5) or re-attach WAL for PITR.
5. Start the API; verify `GET /api/health/ready`, login, and a finance page (trial balance) load.
6. Run `apps/api/scripts/phase14-accounting.mjs` → expect `ACCOUNTING-RESULT: PASS`.
7. Confirm a backup was created post-recovery and retention is pruning correctly.

## 7. Configuration reference (env)

| Var | Purpose | Default |
|-----|---------|---------|
| `BACKUP_DIR` | Backup storage directory | `storage/backups` |
| `BACKUP_ENCRYPTION_KEY` | AES-256-GCM key for backups | unset (plain) |
| `BACKUP_RETENTION` | Number of completed backups kept | `10` |
| `AUDIT_RETENTION` | Days of `AuditLog` to retain | `365` |
| `SCHEDULER_TICK_MS` | Scheduler tick interval | `30000` |
| `DATABASE_URL` | Postgres connection (`?schema=public` stripped before pg_dump) | — |
| `PAYMENT_PROVIDER` / `OBJECT_STORE` / `MESSAGE_PROVIDER` / `QUEUE_PROVIDER` | Adapter mode (`mock` default; real modes require credentials) | `mock`/`local` |
