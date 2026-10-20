import { Landmark, Smartphone } from 'lucide-react';
import type { PayoutAccount, PayoutAccountType } from '../../api/types';

export function accountIcon(type: PayoutAccountType, size = 18) {
  return type === 'bank' ? <Landmark size={size} /> : <Smartphone size={size} />;
}

/** "Ecobank pro — ••••4521" */
export function accountSummary(a: PayoutAccount): string {
  const num = a.type === 'bank' ? a.account_number_masked : a.phone_masked;
  return `${a.label}${num ? ` — ${num}` : ''}`;
}
