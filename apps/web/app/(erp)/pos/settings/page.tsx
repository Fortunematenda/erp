'use client';
import { useEffect, useState } from 'react';
import { Button, Input, Select, Switch } from 'antd';
import { api } from '@/lib/api';
import { notify } from '@/lib/notify';

const MODES = [{ value: 'RETAIL', label: 'Retail' }, { value: 'SERVICE', label: 'Services' }, { value: 'RESTAURANT', label: 'Restaurant' }];

export default function Page() {
  const [boot, setBoot] = useState<any>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [form, setForm] = useState<any>({});
  const [stations, setStations] = useState<any[]>([]);
  const [stationName, setStationName] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadBoot(branchId?: string) {
    const b = await api(`/pos/bootstrap${branchId ? `?branchId=${branchId}` : ''}`);
    setBoot(b);
    setForm(b.settings || {});
    api(`/pos/kitchen/stations?branchId=${b.branch.id}`).then(setStations).catch(() => setStations([]));
  }
  useEffect(() => {
    loadBoot().catch((e) => notify.error(e.message));
    api('/sales/customers').then(setCustomers).catch(() => {});
  }, []);
  if (!boot) return null;
  const set = (patch: any) => setForm((f: any) => ({ ...f, ...patch }));

  async function save() {
    if (!form.retailEnabled && !form.serviceEnabled && !form.restaurantEnabled) { notify.warning('Turn on at least one POS mode'); return; }
    setSaving(true);
    try {
      await api('/pos/settings', { method: 'PUT', body: JSON.stringify({ ...form, branchId: boot.branch.id, fiscalDeviceId: form.fiscalDeviceId || null, walkInCustomerId: form.walkInCustomerId || null }) });
      notify.success('POS settings saved');
    } catch (e: any) { notify.error(e.message); } finally { setSaving(false); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-4 rounded-2xl border border-[#e6e9f0] bg-white p-4">
        {boot.branches?.length > 1 && (
          <label className="block text-[13px]">Branch
            <Select className="mt-1 w-full" value={boot.branch.id} options={boot.branches.map((b: any) => ({ value: b.id, label: b.name }))} onChange={(id) => loadBoot(id).catch((e) => notify.error(e.message))} />
          </label>
        )}
        <div className="text-[14px] font-semibold">Modes</div>
        <label className="flex items-center justify-between text-[13px]">Retail <Switch checked={!!form.retailEnabled} onChange={(v) => set({ retailEnabled: v })} /></label>
        <label className="flex items-center justify-between text-[13px]">Services <Switch checked={!!form.serviceEnabled} onChange={(v) => set({ serviceEnabled: v })} /></label>
        <label className="flex items-center justify-between text-[13px]">Restaurant <Switch checked={!!form.restaurantEnabled} onChange={(v) => set({ restaurantEnabled: v })} /></label>
        <label className="block text-[13px]">Default mode
          <Select className="mt-1 w-full" value={form.defaultMode} options={MODES} onChange={(v) => set({ defaultMode: v })} />
        </label>

        <div className="pt-2 text-[14px] font-semibold">Selling</div>
        <label className="flex items-center justify-between gap-4 text-[13px]"><span>Shelf prices include tax<br /><span className="text-[12px] text-[#64748b]">Tax is extracted from the price instead of added on top.</span></span><Switch checked={!!form.taxInclusive} onChange={(v) => set({ taxInclusive: v })} /></label>
        <label className="flex items-center justify-between gap-4 text-[13px]"><span>Allow sales on account<br /><span className="text-[12px] text-[#64748b]">Only users with the POS credit permission, and never to the walk-in customer.</span></span><Switch checked={!!form.allowCredit} onChange={(v) => set({ allowCredit: v })} /></label>
        <label className="block text-[13px]">Stock warehouse
          <Select className="mt-1 w-full" value={form.defaultWarehouseId} options={(boot.warehouses || []).map((w: any) => ({ value: w.id, label: w.name }))} onChange={(v) => set({ defaultWarehouseId: v })} />
        </label>
        <label className="block text-[13px]">Walk-in customer
          <Select className="mt-1 w-full" allowClear showSearch optionFilterProp="label" value={form.walkInCustomerId} options={customers.map((c) => ({ value: c.id, label: c.name }))} onChange={(v) => set({ walkInCustomerId: v })} />
          <span className="text-[12px] text-[#64748b]">Used for quick sales when the cashier does not pick a customer.</span>
        </label>
        <label className="block text-[13px]">Tip income account code
          <Input className="mt-1" value={form.tipAccountCode || ''} placeholder="Uses normal income resolution when blank" onChange={(e) => set({ tipAccountCode: e.target.value })} />
        </label>

        <div className="pt-2 text-[14px] font-semibold">Fiscalisation</div>
        <label className="block text-[13px]">Fiscal device
          <Select className="mt-1 w-full" allowClear value={form.fiscalDeviceId} placeholder={boot.fiscalDevices?.length ? 'Do not fiscalise at the till' : 'No fiscal devices registered to this branch'}
            options={(boot.fiscalDevices || []).map((d: any) => ({ value: d.id, label: `${d.name} · ${d.serialNumber}` }))} onChange={(v) => set({ fiscalDeviceId: v })} />
          <span className="text-[12px] text-[#64748b]">With a device chosen, each sale is submitted as it completes. Without one, sales in a branch that has devices are marked pending for later submission.</span>
        </label>
        <Button type="primary" loading={saving} onClick={save}>Save settings</Button>
      </section>

      <section className="space-y-3 rounded-2xl border border-[#e6e9f0] bg-white p-4">
        <div className="text-[14px] font-semibold">Kitchen stations</div>
        <p className="text-[12px] text-[#64748b]">Optional. Stations let the kitchen display show only grill, bar or pastry tickets.</p>
        <div className="flex gap-2">
          <Input placeholder="Station name" value={stationName} onChange={(e) => setStationName(e.target.value)} />
          <Button disabled={!stationName.trim()} onClick={async () => {
            try { await api('/pos/kitchen/stations', { method: 'POST', body: JSON.stringify({ branchId: boot.branch.id, name: stationName }) }); setStationName(''); setStations(await api(`/pos/kitchen/stations?branchId=${boot.branch.id}`)); }
            catch (e: any) { notify.error(e.message); }
          }}>Add</Button>
        </div>
        {stations.map((s) => <div key={s.id} className="rounded-lg border border-[#e6e9f0] px-3 py-2 text-[13px]">{s.name}</div>)}
        {!stations.length && <div className="text-[13px] text-[#64748b]">No stations. All tickets show on one screen.</div>}
      </section>
    </div>
  );
}
