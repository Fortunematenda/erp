'use client';
import { useRouter } from 'next/navigation';
import { Button } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { BillManagementList } from '@/components/bill-management-list';
import { PageHeader } from '@/components/ui/page-header';

export default function BillsPage() {
  const router = useRouter();
  return (
    <div className="nex-fade">
      <PageHeader title="Bill Management" description="Supplier Bills and Accounts Payable" actions={<><Button icon={<ReloadOutlined />} onClick={() => router.refresh()} /><Button type="primary" icon={<PlusOutlined />} onClick={() => router.push('/expenses/enter-bill')}>Enter Bill</Button></>} />
      <BillManagementList
        onOpenBill={(id) => router.push(`/procurement/bills?bill=${id}&tab=management`)}
        onGoPay={() => router.push('/expenses/pay-bill')}
      />
    </div>
  );
}
