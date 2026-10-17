# POS architecture

POS is an operational layer. A completed sale creates one `SalesInvoice`, posts it with `PostingService.postSalesInvoice`, issues stock through `InventoryMovementService`, and records each tender as a `Receipt` allocated to that invoice. Fiscalisation calls the existing `FiscalisationService` on that invoice. There is no second sales journal.

## Reused services

| Concern | Service |
| --- | --- |
| Revenue, VAT, AR | `apps/api/src/modules/finance/posting.service.ts` |
| Stock and weighted-average cost | `apps/api/src/modules/inventory/inventory-movement.service.ts` |
| Price lists | `apps/api/src/modules/sales/pricing.service.ts` |
| ZIMRA | `apps/api/src/modules/fiscalisation/fiscalisation.service.ts` |
| Customers, items, branches, warehouses | Existing Prisma models |

## New records

Terminals, registers, shifts, cash movements, POS sales, lines, tenders, returns, branch settings, dining areas, tables, kitchen stations, tickets, modifiers, and recipes. `PosSale.invoiceId` is unique. `PosSale.idempotencyKey` is unique per company.

## Status families

Cart, kitchen order, tender, sale posting, and fiscal track are separate fields. Transitions are validated in `pos.calc.ts`.

## Posting rules

- Held carts do not move stock or post journals.
- Cash and externally approved card, bank, and mobile tenders become receipts. The cashier must enter an approval reference for non-cash tenders. There is no card-acquirer integration in this release.
- Customer credit leaves the invoice unpaid and creates no receipt.
- Recipes issue component stock. The menu or service item posts revenue and is not issued itself when a recipe exists.
- A fiscal failure leaves the accounting sale posted and marks the POS fiscal track `FAILED`. Retry does not create a second fiscal receipt.
- Offline selling is not implemented. The cashier shows connection state and refuses checkout while offline.

## Known limits

- Journals still have no currency. POS sales use the company base currency.
- Tips and service charges are extra invoice lines. They follow the existing income-account resolution. `tipAccountCode` is stored on the branch for later reconciliation and is not a second journal.
- Thermal printers and cash drawers need a device bridge. The browser prints an 80mm receipt.
- ZIMRA payment-method codes for split tenders still need regulator confirmation. The payload sends one row per tender.
