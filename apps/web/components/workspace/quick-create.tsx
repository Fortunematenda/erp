'use client';
import { Button, Dropdown } from 'antd';
import { FileTextOutlined, PlusOutlined, ShoppingCartOutlined, TeamOutlined, UserAddOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';

const items = [
  { key: '/sales/quotations?new=1', label: 'Quotation', icon: <FileTextOutlined /> },
  { key: '/sales/invoices?new=1', label: 'Invoice', icon: <FileTextOutlined /> },
  { key: '/sales/orders?new=1', label: 'Sales Order', icon: <ShoppingCartOutlined /> },
  { key: '/sales/customers?new=1', label: 'Customer', icon: <UserAddOutlined /> },
  { key: '/procurement?new=po', label: 'Purchase Order', icon: <ShoppingCartOutlined /> },
  { key: '/hr?new=employee', label: 'Employee', icon: <TeamOutlined /> },
];

export function QuickCreate() {
  const router = useRouter();
  return (
    <Dropdown menu={{ items, onClick: ({ key }) => router.push(key) }} placement="bottomRight" trigger={['click']}>
      <Button type="primary" icon={<PlusOutlined />} className="!rounded-full">
        <span className="hidden sm:inline">Create</span>
      </Button>
    </Dropdown>
  );
}
