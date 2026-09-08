'use client';
import { useRouter } from 'next/navigation';
import { Button } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { BillManagementList } from '@/components/bill-management-list';

export default function BillsPage() {
  const router = useRouter();
  return (
    <div className="nex-fade">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div><h1 className="text-[26px] font-bold text-[#171a2e]">Bill Management</h1><p className="text-[13px] text-[#64748b]">Supplier Bills and Accounts Payable</p></div>
        <div className="flex items-center gap-2">
          <Button icon={<ReloadOutlined />} onClick={() => router.refresh()} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => router.push('/expenses/enter-bill')}>Enter Bill</Button>
        </div>
      </div>
      <BillManagementList
        onOpenBill={(id) => router.push(`/procurement/bills?bill=${id}&tab=management`)}
        onGoPay={() => router.push('/expenses/pay-bill')}
      />
    </div>
  );
}
