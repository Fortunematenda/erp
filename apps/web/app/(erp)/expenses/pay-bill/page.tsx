'use client';
import { useRouter } from 'next/navigation';
import { Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { PayBillsWorkspace } from '@/components/pay-bills-workspace';
import { PageHeader } from '@/components/ui/page-header';

export default function PayBillsPage() {
  const router = useRouter();
  return (
    <div className="nex-fade">
      <PageHeader title="Pay Bills" description="Select outstanding bills and create supplier payments." actions={<Button icon={<ReloadOutlined />} onClick={() => router.refresh()}>Refresh</Button>} />
      <PayBillsWorkspace onOpenBill={(id) => router.push(`/procurement/bills?bill=${id}`)} />
    </div>
  );
}
