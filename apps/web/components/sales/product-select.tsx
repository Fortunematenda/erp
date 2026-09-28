'use client';
import { Button, Divider, Select } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { productOptions } from '@/components/sales/customer-defaults';
import { fmtMoney } from '@/lib/format';
import { ITEM_TYPE, normalizeItemType } from '@/lib/item-type';

type ProductSelectProps = {
  items: any[] | undefined;
  value?: string;
  disabled?: boolean;
  placeholder?: string;
  onChange: (itemId: string) => void;
  onAddNew?: () => void;
};

function OptionRow({ opt }: { opt: any }) {
  const item = opt.item || {};
  const sku = item.sku || '';
  const name = item.name || opt.label || 'Item';
  const isService = normalizeItemType(item.type) === ITEM_TYPE.SERVICE;
  const price = item.sellingPrice != null ? Number(item.sellingPrice) : item.salesPrice != null ? Number(item.salesPrice) : item.unitPrice != null ? Number(item.unitPrice) : null;

  return (
    <div className="flex items-start justify-between gap-3 py-0.5 w-full min-w-0">
      <div className="min-w-0 flex-1">
        {sku ? <div className="font-mono text-[11px] text-[#94a3b8] leading-tight truncate">{sku}</div> : null}
        <div className="text-[13px] text-[#171a2e] leading-snug truncate">{name}</div>
      </div>
      <div className="shrink-0 text-right pt-0.5">
        {price != null && !Number.isNaN(price) ? (
          <div className="text-[12px] font-medium text-[#344054] tabular-nums">{fmtMoney(price)}</div>
        ) : null}
        {isService ? <div className="text-[10px] uppercase tracking-wide text-[#94a3b8]">Service</div> : null}
      </div>
    </div>
  );
}

/** Invoice-line product picker — SKU + name + price, Xero/QB style. */
export function ProductSelect({ items, value, disabled, placeholder = 'Search item', onChange, onAddNew }: ProductSelectProps) {
  const options = productOptions(items);

  return (
    <Select
      disabled={disabled}
      className="w-full"
      showSearch
      allowClear={false}
      optionFilterProp="searchLabel"
      placeholder={placeholder}
      options={options}
      value={value}
      onChange={onChange}
      popupMatchSelectWidth={false}
      styles={{ popup: { root: { minWidth: 360, maxWidth: 440 } } }}
      optionRender={(ori) => <OptionRow opt={ori.data} />}
      labelRender={(props) => {
        const opt = options.find((o: any) => o.value === props.value);
        const item = opt?.item;
        if (!item) return <span className="truncate font-mono">{props.label}</span>;
        // Selected value shows SKU only — name lives in Description.
        const shown = item.sku || item.name || props.label;
        return <span className={`truncate ${item.sku ? 'font-mono' : ''}`}>{shown}</span>;
      }}
      popupRender={onAddNew ? (menu) => (
        <>
          <div className="p-1">{menu}</div>
          <Divider style={{ margin: '6px 0' }} />
          <Button type="text" size="small" block icon={<PlusOutlined />} onClick={onAddNew}>Add new item</Button>
        </>
      ) : undefined}
    />
  );
}
