'use client';

import type { ReactNode } from 'react';
import { App, Button, Drawer, Form, Modal, Timeline } from 'antd';
import type { ButtonProps, DrawerProps, ModalProps } from 'antd';

export function ERPPrimaryButton(props: ButtonProps) {
  return <Button type="primary" {...props} />;
}

export function ERPSecondaryButton(props: ButtonProps) {
  return <Button {...props} />;
}

export function ERPDrawer({ title, children, extra, width, styles, ...props }: DrawerProps) {
  return (
    <Drawer
      destroyOnHidden
      width={width ?? 480}
      styles={{ body: { padding: 20 }, ...styles }}
      {...props}
      title={<span className="text-[16px] font-semibold">{title}</span>}
      extra={extra}
    >
      {children}
    </Drawer>
  );
}

export function ERPModal({ title, children, ...props }: ModalProps) {
  return (
    <Modal title={<span className="text-[16px] font-semibold">{title}</span>} destroyOnHidden {...props}>
      {children}
    </Modal>
  );
}

let confirmApi: { confirm: typeof Modal.confirm } | null = null;

export function setConfirmApi(api: { confirm: typeof Modal.confirm }) {
  confirmApi = api;
}

export function ERPConfirmDialog(options: { title: string; content?: ReactNode; okText?: string; danger?: boolean; onOk: () => void | Promise<void> }) {
  const modal = confirmApi ?? Modal;
  modal.confirm({
    title: options.title,
    content: options.content,
    okText: options.okText || (options.danger ? 'Delete' : 'Confirm'),
    okButtonProps: options.danger ? { danger: true } : undefined,
    onOk: options.onOk,
  });
}

export function ERPFormField({ label, hint, error, children, required }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; required?: boolean }) {
  return (
    <Form.Item
      label={label}
      required={required}
      help={error || hint}
      validateStatus={error ? 'error' : undefined}
      style={{ marginBottom: 14 }}
    >
      {children}
    </Form.Item>
  );
}

export function ERPDetailPanel({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <section className="nex-card p-4 mb-3">
      {title ? <h3 className="m-0 mb-3 text-[13px] font-semibold text-[var(--foreground)]">{title}</h3> : null}
      {children}
    </section>
  );
}

export function ERPActivityTimeline({ items }: { items: { title: ReactNode; time?: ReactNode; description?: ReactNode }[] }) {
  return (
    <Timeline
      items={items.map((item) => ({
        children: (
          <div>
            <div className="text-[13px] font-medium text-[var(--foreground)]">{item.title}</div>
            {item.time ? <div className="text-[12px] text-[var(--text-faint)]">{item.time}</div> : null}
            {item.description ? <div className="text-[12px] text-[var(--text-muted)] mt-0.5">{item.description}</div> : null}
          </div>
        ),
      }))}
    />
  );
}
