# ZIMRA FDMS Integration Boundary

The ERP uses an isolated `FiscalProvider` interface. `MockZimraProvider` is enabled by default.

Production implementation must cover the official current FDMS operations required for the approved integration, including taxpayer/device onboarding, certificate lifecycle, configuration synchronisation, fiscal-day management, receipt submission, signatures/hashes, receipt validation data/QR requirements, retries/idempotency, and day-close reconciliation.

Never store private keys in the frontend or source control. Production should use encrypted key storage or KMS/HSM-backed secret handling.

Environment modes:
- `mock`: safe local simulation
- `test`: reserved for official ZIMRA test/UAT adapter
- `production`: disabled until the production adapter is implemented and approved

The included production provider deliberately throws `NOT_IMPLEMENTED` rather than pretending to be certified.
