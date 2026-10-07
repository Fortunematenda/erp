import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Input } from 'antd';
import {
  ERPActionMenu,
  ERPActivityTimeline,
  ERPDataTable,
  ERPDateRangePicker,
  ERPDetailPanel,
  ERPDrawer,
  ERPEmptyState,
  ERPErrorState,
  ERPFilterBar,
  ERPFormField,
  ERPModal,
  ERPPageHeader,
  ERPPrimaryButton,
  ERPSearchInput,
  ERPSecondaryButton,
  ERPSectionHeader,
  ERPSkeleton,
  ERPStatCard,
  ERPStatusBadge,
  ERPTabs,
} from '../components/erp';

const meta = {
  title: 'ERP/Components',
} satisfies Meta;

export default meta;

export const PageHeader: StoryObj = {
  render: () => (
    <ERPPageHeader
      title="Invoices"
      description="Issue and post sales invoices"
      breadcrumb="Sales / Invoices"
      actions={
        <>
          <ERPSecondaryButton>Export</ERPSecondaryButton>
          <ERPPrimaryButton>New invoice</ERPPrimaryButton>
        </>
      }
    />
  ),
};

export const Buttons: StoryObj = {
  render: () => (
    <div className="flex gap-2">
      <ERPPrimaryButton>Save</ERPPrimaryButton>
      <ERPSecondaryButton>Cancel</ERPSecondaryButton>
      <ERPPrimaryButton danger>Delete</ERPPrimaryButton>
    </div>
  ),
};

export const StatusBadges: StoryObj = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <ERPStatusBadge status="DRAFT" />
      <ERPStatusBadge status="POSTED" />
      <ERPStatusBadge status="PAID" />
      <ERPStatusBadge status="OVERDUE" />
      <ERPStatusBadge status="VOID" />
    </div>
  ),
};

export const FilterBar: StoryObj = {
  render: () => (
    <ERPFilterBar extra="128 records">
      <ERPSearchInput placeholder="Search invoices" />
      <ERPDateRangePicker />
    </ERPFilterBar>
  ),
};

export const Empty: StoryObj = {
  render: () => (
    <div className="nex-card">
      <ERPEmptyState title="No invoices yet" description="Create an invoice when you are ready to bill a customer." action={<ERPPrimaryButton>New invoice</ERPPrimaryButton>} />
    </div>
  ),
};

export const Error: StoryObj = {
  render: () => <ERPErrorState message="The server did not respond." onRetry={() => undefined} />,
};

export const Skeleton: StoryObj = {
  render: () => (
    <div className="nex-card p-4 max-w-xl">
      <ERPSkeleton rows={4} />
    </div>
  ),
};

export const StatCards: StoryObj = {
  render: () => (
    <div className="grid grid-cols-3 gap-3 max-w-3xl">
      <ERPStatCard label="Revenue" value="$128,400" trend="+4.2%" hint="This month" />
      <ERPStatCard label="Open invoices" value="36" hint="12 overdue" />
      <ERPStatCard label="Cash" value="$54,210" />
    </div>
  ),
};

export const Tabs: StoryObj = {
  render: () => (
    <div className="nex-card">
      <ERPTabs
        items={[
          { key: 'open', label: 'Open', children: <div className="p-4 text-[13px]">Open documents</div> },
          { key: 'posted', label: 'Posted', children: <div className="p-4 text-[13px]">Posted documents</div> },
        ]}
      />
    </div>
  ),
};

export const DataTable: StoryObj = {
  render: () => (
    <ERPDataTable
      rowKey="id"
      dataSource={[
        { id: '1', number: 'INV-1042', customer: 'Acme Ltd', status: 'POSTED', total: '1,240.00' },
        { id: '2', number: 'INV-1043', customer: 'Northwind', status: 'DRAFT', total: '860.00' },
      ]}
      columns={[
        { title: 'Number', dataIndex: 'number' },
        { title: 'Customer', dataIndex: 'customer' },
        { title: 'Status', dataIndex: 'status', render: (status: string) => <ERPStatusBadge status={status} /> },
        { title: 'Total', dataIndex: 'total', align: 'right' },
      ]}
    />
  ),
};

export const ActionMenu: StoryObj = {
  render: () => (
    <ERPActionMenu
      items={[
        { key: 'view', label: 'View', onClick: () => undefined },
        { key: 'edit', label: 'Edit', onClick: () => undefined },
        { key: 'void', label: 'Void', danger: true, confirm: 'Void this invoice?', onClick: () => undefined },
      ]}
    />
  ),
};

function DrawerStory() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ERPPrimaryButton onClick={() => setOpen(true)}>Open drawer</ERPPrimaryButton>
      <ERPDrawer title="Customer" open={open} onClose={() => setOpen(false)}>
        <ERPFormField label="Name" required>
          <Input placeholder="Customer name" />
        </ERPFormField>
        <ERPFormField label="Email" hint="Used on invoices">
          <Input placeholder="name@company.com" />
        </ERPFormField>
      </ERPDrawer>
    </>
  );
}

export const Drawer: StoryObj = { render: () => <DrawerStory /> };

function ModalStory() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ERPSecondaryButton onClick={() => setOpen(true)}>Open modal</ERPSecondaryButton>
      <ERPModal title="Post invoice" open={open} onCancel={() => setOpen(false)} onOk={() => setOpen(false)} okText="Post">
        <p className="m-0 text-[13px] text-[#3c4263]">Posting creates the journal entry and cannot be undone from this screen.</p>
      </ERPModal>
    </>
  );
}

export const Modal: StoryObj = { render: () => <ModalStory /> };

export const DetailAndTimeline: StoryObj = {
  render: () => (
    <div className="max-w-md">
      <ERPSectionHeader title="Invoice" description="INV-1042" />
      <ERPDetailPanel title="Customer">
        <div className="text-[13px]">Acme Ltd</div>
      </ERPDetailPanel>
      <ERPActivityTimeline
        items={[
          { title: 'Posted', time: 'Today, 09:14', description: 'Journal JE-220 created' },
          { title: 'Created', time: 'Yesterday', description: 'Draft saved by admin' },
        ]}
      />
    </div>
  ),
};
