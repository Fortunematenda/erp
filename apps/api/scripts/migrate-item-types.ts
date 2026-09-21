import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const r1 = await prisma.$executeRawUnsafe(
    `UPDATE "InventoryItem" SET type = 'INVENTORY_PRODUCT' WHERE type IN ('INVENTORY', 'INVENTORY_PRODUCT')`,
  );
  const r2 = await prisma.$executeRawUnsafe(
    `UPDATE "InventoryItem" SET type = 'NON_INVENTORY_PRODUCT' WHERE type IN ('NON_INVENTORY', 'NON_INVENTORY_PRODUCT')`,
  );
  const r3 = await prisma.$executeRawUnsafe(
    `UPDATE "InventoryItem" SET type = 'SERVICE' WHERE UPPER(type) = 'SERVICE'`,
  );
  const counts = await prisma.inventoryItem.groupBy({ by: ['type'], _count: true });
  console.log(JSON.stringify({ updated: { r1, r2, r3 }, counts }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
