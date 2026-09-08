'use client';
import { Empty, List } from 'antd';
import { ExclamationCircleOutlined, WarningOutlined, InfoCircleOutlined } from '@ant-design/icons';

const SEV: Record<string, { color: string; icon: any }> = {
  critical: { color: '#b91c1c', icon: <ExclamationCircleOutlined /> },
  warning: { color: '#d97706', icon: <WarningOutlined /> },
  info: { color: '#2563eb', icon: <InfoCircleOutlined /> },
};

export function AttentionPanel({ items, onItem }: { items: any[]; onItem: (it: any) => void }) {
  if (!items?.length) {
    return <div className="rounded-lg border border-slate-200 bg-white p-4 text-[13px] text-slate-500"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No integration issues" /></div>;
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <List
        size="small"
        dataSource={items}
        renderItem={(it: any) => {
          const s = SEV[it.severity] || SEV.info;
          return (
            <List.Item
              className="cursor-pointer !px-3.5 hover:bg-slate-50"
              onClick={() => onItem(it)}
            >
              <div className="flex w-full items-start gap-2.5">
                <span style={{ color: s.color }} className="mt-0.5">{s.icon}</span>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium" style={{ color: '#171a2e' }}>{it.title}</div>
                  <div className="text-[11px] text-slate-400">{it.integrationLabel} · click to open</div>
                </div>
              </div>
            </List.Item>
          );
        }}
      />
    </div>
  );
}
