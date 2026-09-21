import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const counts = await prisma.inventoryItem.groupBy({ by: ['type'], _count: true });
  console.log(JSON.stringify(counts, null, 2));
}

main().finally(() => prisma.$disconnect());
