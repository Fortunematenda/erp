'use client';
import { useEffect, useState } from 'react';
import { Input } from 'antd';
import { formatPhoneNumber, formatPhoneInput, normalizePhoneNumber } from '@/lib/phone-format';
import { type CountryCode } from 'libphonenumber-js';

export function PhoneInput({ value, onChange, country = 'ZW', placeholder, size, disabled, allowClear, style, className }: {
  value?: string; onChange?: (v: string) => void; country?: CountryCode; placeholder?: string; size?: any; disabled?: boolean; allowClear?: boolean; style?: React.CSSProperties; className?: string;
}) {
  const [display, setDisplay] = useState('');
  // Sync external value → local (Zimbabwe) display when the form pre-fills an existing E.164.
  useEffect(() => { setDisplay(formatPhoneNumber(value, country)); }, [value, country]);

  return (
    <Input
      placeholder={placeholder || (country === 'ZW' ? '077 123 4567' : 'Phone')}
      size={size} disabled={disabled} allowClear={allowClear} style={style} className={className}
      value={display}
      inputMode="tel"
      onChange={(e) => {
        const raw = e.target.value;
        setDisplay(formatPhoneInput(raw, country));
        onChange?.(normalizePhoneNumber(raw, country));
      }}
    />
  );
}
