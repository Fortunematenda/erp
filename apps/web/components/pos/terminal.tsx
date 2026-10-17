'use client';

import { RestaurantTerminal } from './restaurant-terminal';
import { RetailTerminal } from './retail-terminal';
import { ServiceTerminal } from './service-terminal';
import type { PosMode } from './use-pos';

export { PosReceipt } from './pos-dialogs';

export function PosTerminal({ mode }: { mode: PosMode }) {
  if (mode === 'SERVICE') return <ServiceTerminal />;
  if (mode === 'RESTAURANT') return <RestaurantTerminal />;
  return <RetailTerminal />;
}
