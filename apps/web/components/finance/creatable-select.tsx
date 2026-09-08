'use client';
import { Button, Divider, Empty, Select } from 'antd';
import { PlusOutlined } from '@ant-design/icons';

type Opt = { value: string; label: React.ReactNode; searchText?: string; disabled?: boolean };

// A searchable Select with a consistent "+ Add New" dropdown footer, used so
// users can create a related entity without leaving the enclosing form.
export function CreatableSelect({
  options, value, onChange, placeholder, allowClear = true, disabled,
  createLabel, onCreate, canCreate = false, emptyText = 'No options available.',
  className, optionRender,
}: {
  options: Opt[];
  value?: string | null;
  onChange?: (v: string | undefined) => void;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  createLabel: string;
  onCreate: () => void;
  canCreate?: boolean;
  emptyText?: string;
  className?: string;
  optionRender?: (o: Opt) => React.ReactNode;
}) {
  const filter = (input: string, o2: any) => {
    const text = String(o2.searchText || o2.label || '').toLowerCase();
    return text.includes(input.toLowerCase());
  };
  const EmptyContent = canCreate ? (
    <div className="flex flex-col items-center gap-2 py-3">
      <span className="text-[13px]" style={{ color: '#667085' }}>{emptyText}</span>
      <Button type="link" size="small" className="!px-0" style={{ color: '#175CD3' }} icon={<PlusOutlined />} onClick={onCreate}>{createLabel}</Button>
    </div>
  ) : (<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} imageStyle={{ height: 40 }} />);

  const menu = (
    <Select
      value={value ?? undefined}
      onChange={(v?: string) => onChange?.(v)}
      placeholder={placeholder}
      allowClear={allowClear}
      disabled={disabled}
      showSearch
      autoClearSearchValue={false}
      filterOption={filter}
      optionFilterProp="label"
      className={className}
      popupMatchSelectWidth
      notFoundContent={EmptyContent}
      dropdownRender={(m) => (
        <>
          {m}
          {canCreate && (
            <>
              <Divider style={{ margin: '4px 0' }} />
              <button
                type="button"
                onClick={() => { onCreate(); }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-[13px] font-medium bg-transparent hover:bg-[#f5f7ff] cursor-pointer rounded"
                style={{ color: '#175CD3' }}
              >
                <PlusOutlined /> {createLabel}
              </button>
            </>
          )}
        </>
      )}
      options={options.map((o) => ({ ...o, label: optionRender ? optionRender(o) : o.label }))}
    />
  );
  return menu;
}
