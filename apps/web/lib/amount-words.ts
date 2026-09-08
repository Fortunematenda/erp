const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function words(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`;
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' + words(n % 100) : ''}`;
  if (n < 1_000_000) {
    const thousands = Math.floor(n / 1000);
    const rest = n % 1000;
    return `${words(thousands)} Thousand${rest ? ' ' + words(rest) : ''}`;
  }
  if (n < 1_000_000_000) {
    const millions = Math.floor(n / 1_000_000);
    const rest = n % 1_000_000;
    return `${words(millions)} Million${rest ? ' ' + words(rest) : ''}`;
  }
  return String(n);
}

export function amountInWords(v: number): string {
  const whole = Math.floor(Math.abs(v));
  const cents = Math.round((Math.abs(v) - whole) * 100);
  if (!whole && !cents) return 'Zero and 00/100 Dollars';
  return `${words(whole)} and ${String(cents).padStart(2, '0')}/100 Dollars`;
}
