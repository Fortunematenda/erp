# NexusERP Improved Source Package — 2026-09-07

## Included
- Complete active Next.js web application source under `apps/web`.
- Complete active NestJS/Prisma API source under `apps/api`.
- Prisma schema and seed data.
- Windows native setup/start scripts.
- Existing ERP documentation plus the improved-release notes.
- Package manifests and lockfile.

## Improvements added in this package
- Live ERP Action Centre in the header.
- Cross-module record search with Ctrl/Cmd+K.
- Quick Create menu for frequent ERP transactions.
- New Workspace API (`/workspace/search`, `/workspace/action-center`).
- Preserved central customer defaults and PricingService architecture for sales documents.
- Repaired `.gitignore` and added a missing web environment template.
- Clean source handoff with local credentials, database dumps, build output and dependencies excluded.

## Intentionally excluded from the ZIP
These are generated/runtime/local files and are not part of the source release:
- `.git/`
- `node_modules/`
- `.next/`
- `dist/`
- local `.env` / `.env.local` / root `env`
- database dumps/backups
- runtime uploads and caches
- duplicate legacy `nexuserp-ts/` snapshot that existed inside the uploaded archive

## Verification performed in this environment
- Parsed/transpiled all active TypeScript/TSX source files for syntax diagnostics.
- Confirmed no local `.env`, `.env.local`, root `env`, database dump or backup file remains in the release tree.
- Full dependency-backed `npm build` was not completed in the sandbox because package installation could not complete through the environment transport. Run the normal local setup and `npm run build` before production deployment.
