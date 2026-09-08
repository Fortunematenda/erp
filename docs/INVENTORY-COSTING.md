# NexusERP Inventory Costing

## Valuation method
- **Current/authoritative: WEIGHTED_AVERAGE** (per item). Valuation = `onHand × avgCost`, where `avgCost` = (Σ receipt unitCost × qty) / (Σ receipt qty). Exposed via `GET /inventory/valuation`.
- FIFO/AVCO **not implemented** as actual cost layers (would need a `CostLayer` table + per-issue layer allocation). The company/valuation-method config field is reserved; FIFO would require cost layers and is documented as future work rather than faking average as FIFO.

## Inventory receipt GL / no double-count
Chosen single-authoritative approach (avoids double posting):
- **GRN post** (`POST /procurement/grns/:id/post`) updates quantity/cost only (creates `StockMovement RECEIPT`) and increments PO line `receivedQty`. **No journal.**
- **Supplier invoice post** (`POST /procurement/supplier-invoices/:id/post`) is the financial recognition:
  - stock items: `Dr 1200 Inventory` (+ `Dr 2100 Input VAT`) / `Cr 2000 AP`
  - expense items: `Dr 6000 Expense` (+ `Dr 2100 Input VAT`) / `Cr 2000 AP`
- Therefore inventory value is capitalized once (at bill posting), never twice.

## COGS posting (sales dispatch)
`POST /sales/deliveries/:id/dispatch`:
- Creates a `StockMovement ISSUE` (warehouse) for each line.
- Posts COGS journal (only when avg cost > 0):
  - `Dr 6100 Cost of Sales` (= qty × weighted-average cost)
  - `Cr 1200 Inventory`
  - `sourceType = COGS`, `sourceId = deliveryNoteId`, references the delivery & movement.
- Cost is the **weighted-average inventory cost** (never selling price).
- Updates `SalesOrderLine.deliveredQty` and marks the Sales Order `FULFILLED` when fully delivered.

## Batch / serial (scaffolding)
- `InventoryBatch`, `SerialNumber` models exist (company/item/warehouse/batchNo/serialNo/status + `trackBatch`/`trackSerial` flags on `InventoryItem`).
- Enforcement on receipt/issue forms and batch/serial allocation is **not yet wired into the UI**; the models + flags are in place (documented as follow-up).
