# NexusERP Inventory Costing

## Valuation method
- **Current/authoritative: WEIGHTED_AVERAGE** (per item). Valuation = `onHand × avgCost`, where `avgCost` = (Σ receipt unitCost × qty) / (Σ receipt qty). Exposed via `GET /inventory/valuation`.
- FIFO/AVCO **not implemented** as actual cost layers (would need a `CostLayer` table + per-issue layer allocation). The company/valuation-method config field is reserved; FIFO would require cost layers and is documented as future work rather than faking average as FIFO.

## Inventory receipt GL / GRNI accrual (no double-count)
Adopted the **GRNI (Goods Received Not Invoiced)** accrual model. Inventory is
capitalised exactly once — by the goods receipt — and the bill clears GRNI:
- **GRN post** (`POST /procurement/grns/:id/post`) creates the `StockMovement RECEIPT`,
  increments PO line `receivedQty`, and posts `Dr Inventory Asset / Cr 2050 GRNI`
  for the received value (`sourceType = GOODS_RECEIPT`).
- **Supplier invoice post** (`POST /procurement/supplier-invoices/:id/post`):
  - inventory items: `Dr 2050 GRNI` (+ `Dr 2100 Input VAT`) / `Cr 2000 AP` (clears GRNI)
  - expense/non-inventory/service items: `Dr 6000 Expense` (+ `Dr 2100 Input VAT`) / `Cr 2000 AP`
- A **direct bill with goods received now** (`receiveNow`) creates the receipt (GRNI
  posting) then the bill clears GRNI → net `Dr Inventory / Cr AP`.
- A **bill before goods** debits `2050 GRNI` and records `unreceivedQty`; no stock is
  shown until the receipt arrives (`Dr Inventory / Cr GRNI`).
- Net effect is always `Dr Inventory / Cr AP` for received inventory, never twice.
- GRNI account `2050` is created on demand per company.

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
