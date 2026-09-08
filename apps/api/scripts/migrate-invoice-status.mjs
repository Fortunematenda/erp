import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

function resolvePaymentStatus(invoiceStatus, dueDate, total, amountPaid, creditsApplied) {
  const balanceDue = Math.max(0, Number(total) - Number(amountPaid) - Number(creditsApplied));
  const paid = Math.max(0, Number(amountPaid) + Number(creditsApplied));
  let status;
  if (balanceDue <= 0.005) status = 'PAID';
  else if (paid > 0.005) status = 'PARTIALLY_PAID';
  else if (invoiceStatus === 'POSTED' && dueDate && new Date(dueDate) < (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })()) status = 'OVERDUE';
  else status = 'UNPAID';
  return { status, balanceDue: Number(balanceDue.toFixed(2)) };
}

async function main() {
  const invoices = await prisma.salesInvoice.findMany({
    include: { receipts: true, creditNotes: true },
    orderBy: { createdAt: 'asc' },
  });
  let updated = 0;
  for (const inv of invoices) {
    const hadPosting = await prisma.journalEntry.findFirst({ where: { sourceType: 'SALES_INVOICE', sourceId: inv.id } });
    const old = (inv.status || '').toUpperCase();
    let invoiceStatus;
    if (old === 'VOID') invoiceStatus = 'VOID';
    else if (hadPosting || ['POSTED', 'PAID', 'PART_PAID'].includes(old)) invoiceStatus = 'POSTED';
    else invoiceStatus = 'DRAFT';
    const amountPaid = (inv.receipts || []).reduce((s, r) => s + Number(r.amount), 0);
    const creditsApplied = (inv.creditNotes || []).filter((c) => c.status === 'POSTED').reduce((s, c) => s + Number(c.total), 0);
    const { status, balanceDue } = resolvePaymentStatus(invoiceStatus, inv.dueDate, Number(inv.total), amountPaid, creditsApplied);
    await prisma.salesInvoice.update({
      where: { id: inv.id },
      data: { invoiceStatus, paymentStatus: status, amountPaid, creditsApplied, balanceDue },
    });
    console.log(`${inv.invoiceNo}: old=${old} -> inv=${invoiceStatus} pay=${status} paid=${amountPaid} bal=${balanceDue}`);
    updated++;
  }
  console.log(`Migrated ${updated} invoices.`);
}
main().finally(() => prisma.$disconnect());
