# Production Roadmap

Before commercial deployment:

1. Complete ZIMRA official test/UAT and production adapter.
2. Obtain/confirm current statutory PAYE, NSSA and tax rules and implement effective-dated calculators with independent verification.
3. Harden authentication: MFA, password reset, email verification, refresh-token rotation, SSO where required.
4. Move fiscal private keys to encrypted KMS/HSM-style storage.
5. Introduce Redis/BullMQ workers for fiscal retries, email, reports, payroll and integrations.
6. Add object storage for documents and generated reports.
7. Add full approval/workflow engine and segregation-of-duties controls.
8. Add period close/lock, accounting dimensions, bank reconciliation, budgets and advanced fixed assets.
9. Add robust inventory costing (FIFO/weighted average as approved), batch/serial workflows and stock count control.
10. Add subscription billing/payment gateway adapter and usage metering.
11. Add observability, alerting, backups, PITR, DR drills, vulnerability scanning and audit retention.
12. Complete performance/load testing, penetration testing and business UAT.
13. Publish deployment/runbooks, SLA, support and incident procedures.
