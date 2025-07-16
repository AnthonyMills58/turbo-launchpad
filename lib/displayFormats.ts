export function formatETH(value: number): string {
  const str = value.toFixed(18).replace(/\.?0+$/, ''); // usuwa końcowe zera
  const [intPart, decPart] = str.split('.');

  if (!decPart) return intPart;

  let result = '';
  let count = 0;

  for (const digit of decPart) {
    result += digit;
    if (digit !== '0') count++;
    if (count === 2) break;
  }

  return `${intPart}.${result}`;
}

export function formatValue(value: number): string {
  if (value === 0) return '0';

  // Convert to string with many decimal places
  const str = value.toFixed(18).replace(/\.?0+$/, '');
  const [intPart, decPart] = str.split('.');

  if (!decPart) return intPart;

  let result = '';
  let count = 0;

  for (let i = 0; i < decPart.length; i++) {
    const digit = decPart[i];
    result += digit;
    if (digit !== '0') count++;
    if (count === 2) {
      // Check if next digit exists and is ≥ 5 → round up
      if (i + 1 < decPart.length && parseInt(decPart[i + 1]) >= 5) {
        const rounded = (parseFloat(`0.${result}`) + Math.pow(10, -result.length)).toFixed(result.length);
        return `${intPart}.${rounded.split('.')[1]}`;
      }
      break;
    }
  }

  return `${intPart}.${result}`;
}

