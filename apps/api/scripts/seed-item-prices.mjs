import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const res = await p.inventoryItem.updateMany({ data: { sellingPrice: 200 } });
const items = await p.inventoryItem.findMany({ select: { sku: true, sellingPrice: true } });
console.log('updated', res.count, await Promise.resolve(JSON.stringify(items)));
await p.$disconnect();
