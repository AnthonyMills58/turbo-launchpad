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

export function formatValue(value: number | null | undefined): string {
  if (value === 0) return '0';
  if (value === null || value === undefined) return '0';
  if (isNaN(value)) return '0';
  if (typeof value !== 'number') return '0';

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

/**
 * Format large numbers with K, M, B suffixes
 * @param value - Number to format
 * @returns Formatted string with appropriate suffix
 */
export function formatLargeNumber(value: number | null | undefined): string {
  if (value === 0) return '0';
  if (value === null || value === undefined) return '0';
  if (isNaN(value)) return '0';
  if (typeof value !== 'number') return '0';
  
  const absValue = Math.abs(value);
  
  if (absValue >= 1e9) {
    // Billions
    const formatted = (value / 1e9).toFixed(2);
    return `${formatted.replace(/\.?0+$/, '')}B`;
  } else if (absValue >= 1e6) {
    // Millions
    const formatted = (value / 1e6).toFixed(2);
    return `${formatted.replace(/\.?0+$/, '')}M`;
  } else if (absValue >= 1e3) {
    // Thousands
    const formatted = (value / 1e3).toFixed(2);
    return `${formatted.replace(/\.?0+$/, '')}K`;
  } else {
    // Less than 1000, use original formatting
    return formatValue(value);
  }
}

