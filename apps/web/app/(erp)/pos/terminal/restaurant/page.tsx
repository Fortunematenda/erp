'use client';
import { Suspense } from 'react';
import { PosTerminal } from '@/components/pos/terminal';
export default function Page() { return <Suspense><PosTerminal mode="RESTAURANT" /></Suspense>; }
