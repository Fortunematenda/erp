'use client';
import type { ReactNode } from 'react';
import { Button, Dropdown, Modal, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { MoreOutlined } from '@ant-design/icons';
import { useAuthPermissions } from '@/components/Can';

export type RowActionItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  hidden?: boolean;
  permission?: string | string[];
  /** Shown before running onClick. Same handler; confirmation only. */
  confirm?: string | { title: string; content?: string; okText?: string };
};

export const ACTIONS_COL = {
  title: 'Actions',
  key: 'actions',
  width: 56,
  align: 'center' as const,
  fixed: 'right' as const,
};

function permitted(permissions: string[], need?: string | string[]) {
  if (!need) return true;
  const list = Array.isArray(need) ? need : [need];
  return list.some((p) => permissions.includes(p));
}

function labelOf(it: RowActionItem) {
  if (it.disabled && it.disabledReason) {
    return <Tooltip title={it.disabledReason}><span>{it.label}</span></Tooltip>;
  }
  return it.label;
}

export function RowActionsMenu({ items }: { items: RowActionItem[] }) {
  const { permissions, isLoading } = useAuthPermissions();
  const visible = items.filter((it) => !it.hidden && (!it.permission || (!isLoading && permitted(permissions, it.permission))));
  if (!visible.length) return null;

  const normal = visible.filter((it) => !it.danger);
  const danger = visible.filter((it) => it.danger);

  function run(it: RowActionItem) {
    if (it.disabled || !it.onClick) return;
    if (it.confirm) {
      const cfg = typeof it.confirm === 'string' ? { title: it.confirm } : it.confirm;
      Modal.confirm({
        title: cfg.title,
        content: cfg.content,
        okText: cfg.okText || (it.danger ? 'Delete' : 'OK'),
        okButtonProps: it.danger ? { danger: true } : undefined,
        onOk: () => it.onClick?.(),
      });
      return;
    }
    it.onClick();
  }

  const menuItems: MenuProps['items'] = [
    ...normal.map((it) => ({ key: it.key, icon: it.icon, label: labelOf(it), disabled: it.disabled })),
    ...(normal.length && danger.length ? [{ type: 'divider' as const }] : []),
    ...danger.map((it) => ({ key: it.key, icon: it.icon, label: labelOf(it), disabled: it.disabled, danger: true })),
  ];

  return (
    <Dropdown
      menu={{
        items: menuItems,
        onClick: ({ key, domEvent }) => {
          domEvent.stopPropagation();
          const it = visible.find((i) => i.key === key);
          if (it) run(it);
        },
      }}
      trigger={['click']}
      placement="bottomRight"
      getPopupContainer={() => document.body}
    >
      <Button
        type="text"
        aria-label="More actions"
        icon={<MoreOutlined style={{ fontSize: 16 }} />}
        className="!w-8 !h-8 !inline-flex !items-center !justify-center"
        onClick={(e) => e.stopPropagation()}
      />
    </Dropdown>
  );
}
