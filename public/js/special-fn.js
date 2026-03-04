// Special mathematical functions for Gamma distribution fitting
// logGamma (Lanczos), digamma (ψ), trigamma (ψ')

/**
 * Log-Gamma function using Lanczos approximation (g=7, ~15 digits accuracy)
 */
export function logGamma(x) {
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  const c = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7
  ];
  const t = x + 7.5;
  let a = c[0];
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * Digamma function ψ(x) = d/dx logΓ(x)
 * Uses asymptotic expansion for x≥8, recurrence ψ(x) = ψ(x+1) - 1/x for x<8
 */
export function digamma(x) {
  if (x <= 0 && x === Math.floor(x)) return -Infinity; // poles at non-positive integers

  let result = 0;
  // Use recurrence to shift x up to ≥8
  while (x < 8) {
    result -= 1 / x;
    x += 1;
  }
  // Asymptotic expansion for large x
  const x2 = 1 / (x * x);
  result += Math.log(x) - 0.5 / x
    - x2 * (1/12 - x2 * (1/120 - x2 * (1/252 - x2 * (1/240 - x2 * (1/132)))));
  return result;
}

/**
 * Trigamma function ψ'(x) = d²/dx² logΓ(x)
 * Uses asymptotic expansion for x≥8, recurrence ψ'(x) = ψ'(x+1) + 1/x² for x<8
 */
export function trigamma(x) {
  if (x <= 0 && x === Math.floor(x)) return Infinity;

  let result = 0;
  while (x < 8) {
    result += 1 / (x * x);
    x += 1;
  }
  // Asymptotic expansion
  const x2 = 1 / (x * x);
  result += 1/x + x2 * (0.5 + x2 * (1/6 - x2 * (1/30 - x2 * (1/42 - x2 * (1/30)))));
  return result;
}
