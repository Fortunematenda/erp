'use client';
import { useRouter } from 'next/navigation';
import { Button } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { EnterBillForm } from '@/components/enter-bill-form';

export default function EnterBillPage() {
  const router = useRouter();
  return (
    <div className="nex-fade w-full">
      <div className="flex items-center justify-between border-b border-[#eef0f6] pb-4 mb-6">
        <div className="flex items-center gap-3">
          <button className="w-8 h-8 rounded-lg flex items-center justify-center text-[#475060] hover:bg-[#f0f1f7] hover:text-[#003366] transition-colors" onClick={() => router.push('/expenses/bills')} aria-label="Back"><CloseOutlined /></button>
          <h1 className="text-[22px] font-bold text-[#171a2e] m-0">Enter Bill</h1>
        </div>
        <Button onClick={() => router.push('/expenses/bills')}>Cancel</Button>
      </div>

      <EnterBillForm variant="page" onSaved={() => router.push('/expenses/bills')} onCancel={() => router.push('/expenses/bills')} />
    </div>
  );
}
