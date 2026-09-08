'use client';
import { useRouter } from 'next/navigation';
import { Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { PayBillsWorkspace } from '@/components/pay-bills-workspace';

export default function PayBillsPage() {
  const router = useRouter();
  return (
    <div className="nex-fade">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div><h1 className="text-[26px] font-bold text-[#171a2e]">Pay Bills</h1><p className="text-[13px] text-[#64748b]">Select outstanding bills and create supplier payments.</p></div>
        <Button icon={<ReloadOutlined />} onClick={() => router.refresh()}>Refresh</Button>
      </div>
      <PayBillsWorkspace onOpenBill={(id) => router.push(`/procurement/bills?bill=${id}`)} />
    </div>
  );
}
