"use strict";

// ------------------------------------------------------------
// Parameters
// ------------------------------------------------------------

const R_MAX = 17;
const MAX_SCAN_SIZE = 4;


// ------------------------------------------------------------
// Precomputed constants
// ------------------------------------------------------------

const TEN_POW_BIG = Array.from(
  { length: R_MAX },
  (_, r) => 10n ** BigInt(r)
);

const HEX_POW = Array.from(
  { length: R_MAX },
  (_, r) => 16 ** r
);

const HEX_SCALES = Array.from(
  { length: R_MAX },
  (_, r) => 16 ** (-r)
);

// Python:
// POW10_SHIFT = tuple(Decimal(10) ** r for r in range(1 - r_max, r_max))
const POW10_SHIFT = Array.from(
  { length: 2 * R_MAX - 1 },
  (_, i) => 1 - R_MAX + i
);

// Python:
// POW2_SHIFT = tuple(Decimal(2) ** r for r in range(1 - r_max, 0))
const POW2_SHIFT = Array.from(
  { length: R_MAX - 1 },
  (_, i) => 1 - R_MAX + i
);


// ------------------------------------------------------------
// Basic utilities
// ------------------------------------------------------------

function is_2pow(n) {
  return n === 0 || (n > 0 && (n & (n - 1)) === 0);
}

function bitLength(n) {
  if (n <= 0) return 0;
  return Math.floor(Math.log2(n)) + 1;
}

function size2int(size) {
  return size > 0 ? (2 ** (4 * bitLength(size))) + 1 : 1;
}

function getCached(cache, key, build) {
  if (cache.has(key)) {
    return cache.get(key);
  }

  const value = build();
  cache.set(key, value);
  return value;
}


// ------------------------------------------------------------
// Decimal-like representation
//
// Python 側では Decimal 計算をしてから float 化する。
// JS 側でも、decimal 系の値はすぐ Number にせず、
//   coeff * 10^exp
// の形で保持し、最後に Number(`${coeff}e${exp}`) で丸める。
// ------------------------------------------------------------

function roundCoeffToPrecision(coeff, exp) {
  // Python の Decimal context precision = 17 に寄せる。
  // 正数のみを扱う。
  let s = coeff.toString();

  if (s.length <= R_MAX) {
    return { coeff, exp };
  }

  const cut = s.length - R_MAX;
  const headStr = s.slice(0, R_MAX);
  const tailStr = s.slice(R_MAX);

  let head = BigInt(headStr);

  const first = tailStr.charCodeAt(0) - 48;
  let restNonZero = false;

  for (let i = 1; i < tailStr.length; i++) {
    if (tailStr.charCodeAt(i) !== 48) {
      restNonZero = true;
      break;
    }
  }

  // Decimal の既定丸め ROUND_HALF_EVEN に寄せる。
  const shouldRoundUp =
    first > 5 ||
    (first === 5 && (restNonZero || (head & 1n) === 1n));

  if (shouldRoundUp) {
    head += 1n;
  }

  exp += cut;

  // 999... の繰り上がりで桁数が増えた場合
  if (head.toString().length > R_MAX) {
    head /= 10n;
    exp += 1;
  }

  return { coeff: head, exp };
}

function normalizeDec(coeff, exp) {
  if (coeff === 0n) {
    return null;
  }

  if (coeff < 0n) {
    throw new Error("normalizeDec expects positive coeff");
  }

  ({ coeff, exp } = roundCoeffToPrecision(coeff, exp));

  while (coeff % 10n === 0n) {
    coeff /= 10n;
    exp += 1;
  }

  return {
    coeff,
    exp,
    key: `${coeff.toString()}e${exp}`
  };
}

function addDec(map, coeff, exp) {
  const v = normalizeDec(coeff, exp);

  if (v !== null && !map.has(v.key)) {
    map.set(v.key, v);
  }
}

function decToNumber(v, shift = 0) {
  // ここが重要。
  // Number 演算で x * 10**r を作らず、
  // Decimal の指数をずらした後に Number 化する。
  return Number(`${v.coeff.toString()}e${v.exp + shift}`);
}


// ------------------------------------------------------------
// Pair generation
// ------------------------------------------------------------

const DEC_PAIRS_CACHE = new Map();
const HEX_PAIRS_CACHE = new Map();

function decPairs(size) {
  return getCached(DEC_PAIRS_CACHE, size, () => {
    if (size < 0) return [];

    const out = [];

    for (let a = 0; a <= size; a++) {
      const b = size - a;

      if (is_2pow(a) && is_2pow(b)) {
        out.push([a, b]);
      }
    }

    return out;
  });
}

function hexPairs(size) {
  return getCached(HEX_PAIRS_CACHE, size, () => {
    if (size < 0) return [];

    const out = [];

    for (let a = 1; a < size; a++) {
      const b = size - a;

      if (is_2pow(a) && is_2pow(b)) {
        out.push([a, b]);
      }
    }

    if (size >= 1 && is_2pow(size - 1)) {
      out.push([0, size - 1]);
    }

    return out;
  });
}


// ------------------------------------------------------------
// Decimal positive candidates
//
// Python:
//   Decimal(num) * Decimal(10) ** (-r)
//
// JS:
//   num * 10^(-r) を Number で作らず、
//   { coeff: num, exp: -r } として保持する。
// ------------------------------------------------------------

const GEN_SIZE_DEC_POSITIVE_CACHE = new Map();

function genSizeDecPositiveCached(size) {
  return getCached(GEN_SIZE_DEC_POSITIVE_CACHE, size, () => {
    if (size < 0) {
      return [];
    }

    const seen = new Map();

    for (const [leftSize, rightSize] of decPairs(size)) {
      const P = size2int(leftSize);
      const Q = size2int(rightSize);

      for (let r = 0; r < R_MAX; r++) {
        const stepBig = TEN_POW_BIG[r];

        for (let p = 0; p < P; p++) {
          const bound = BigInt(P - p) * stepBig;
          const qLim = bound < BigInt(Q) ? Number(bound) : Q;
          const base = BigInt(p) * stepBig;

          for (let q = 0; q < qLim; q++) {
            const num = base + BigInt(q);

            if (num !== 0n) {
              addDec(seen, num, -r);
            }
          }
        }
      }
    }

    return Array.from(seen.values());
  });
}


// ------------------------------------------------------------
// Hex positive candidates
//
// 16進系は 2 の冪分母なので、Number 直接生成でも
// decimal shift 問題のような 10進シフト誤差は起こりにくい。
// ここは速度優先で従来通り Number 生成にする。
// ------------------------------------------------------------

const GEN_SIZE_HEX_POSITIVE_CACHE = new Map();

function genSizeHexPositiveCached(size) {
  return getCached(GEN_SIZE_HEX_POSITIVE_CACHE, size, () => {
    if (size < 0) {
      return new Set();
    }

    const out = new Set();

    for (const [leftSize, rightSize] of hexPairs(size)) {
      const P = size2int(leftSize);
      const Q = size2int(rightSize);

      for (let r = 0; r < R_MAX; r++) {
        const step = HEX_POW[r];
        const scale = HEX_SCALES[r];

        for (let p = 0; p < P; p++) {
          const qLim = Math.min(Q, (P - p) * step);

          for (let q = 0; q < qLim; q++) {
            if (p !== 0 || q !== 0) {
              out.add(p + q * scale);
            }
          }
        }
      }
    }

    return out;
  });
}


// ------------------------------------------------------------
// Positive cumulative gen_size
//
// 旧 gen_size(size) から正数だけを取り出した累積集合。
// public には出さず、shell 計算用に使う。
// ------------------------------------------------------------

const GEN_SIZE_POSITIVE_CUMULATIVE_CACHE = new Map();

function genSizePositiveCumulativeCached(size) {
  return getCached(GEN_SIZE_POSITIVE_CUMULATIVE_CACHE, size, () => {
    if (size < 0) {
      return new Set();
    }

    const out = new Set();

    // decimal body
    for (const x of genSizeDecPositiveCached(size)) {
      const y = decToNumber(x);
      if (y !== 0) out.add(y);
    }

    // decimal shifted
    if (size - 1 >= 0) {
      for (const x of genSizeDecPositiveCached(size - 1)) {
        for (const shift of POW10_SHIFT) {
          const y = decToNumber(x, shift);
          if (y !== 0) out.add(y);
        }
      }
    }

    // hex body
    for (const x of genSizeHexPositiveCached(size)) {
      if (x !== 0) out.add(x);
    }

    // hex shifted
    if (size - 2 >= 0) {
      for (const x of genSizeHexPositiveCached(size - 2)) {
        for (const shift of POW2_SHIFT) {
          const y = x * (2 ** shift);
          if (y !== 0) out.add(y);
        }
      }
    }

    // pi
    if (size >= 1) {
      out.add(Math.PI);
    }

    out.delete(0);
    out.delete(-0);

    return out;
  });
}


// ------------------------------------------------------------
// Public gen_size
//
// この gen_size(size) は、scan 用の正数 shell。
// 旧 positive_shell(size) 相当。
// ------------------------------------------------------------

const GEN_SIZE_POSITIVE_SHELL_CACHE = new Map();

function genSizePositiveShellCached(size) {
  return getCached(GEN_SIZE_POSITIVE_SHELL_CACHE, size, () => {
    if (size < 1) {
      return [];
    }

    if (size > MAX_SCAN_SIZE) {
      throw new RangeError(
        `optimized gen_size only supports sizes 1..${MAX_SCAN_SIZE}; got ${size}`
      );
    }

    const cur = genSizePositiveCumulativeCached(size);
    const prev = genSizePositiveCumulativeCached(size - 1);

    const out = [];

    for (const a of cur) {
      if (!prev.has(a)) {
        out.push(a);
      }
    }

    return out;
  });
}

function gen_size(size) {
  return genSizePositiveShellCached(size);
}


// ------------------------------------------------------------
// Compatibility: gen_int
// ------------------------------------------------------------

const GEN_INT_CACHE = new Map();

function genIntCached(size) {
  return getCached(GEN_INT_CACHE, size, () => {
    if (size < 0) {
      return new Set();
    }

    const out = new Set();

    const P = size2int(size);
    const Q = size2int(size - 1);

    for (let x = 1 - P; x < P; x++) {
      out.add(x);
    }

    for (let p = 1 - Q; p < Q; p++) {
      for (let r = 0; r < R_MAX; r++) {
        out.add(p * (10 ** r));
      }
    }

    return out;
  });
}

function gen_int(size) {
  return new Set(genIntCached(size));
}


// ------------------------------------------------------------
// Browser globals
// ------------------------------------------------------------

if (typeof window !== "undefined") {
  window.R_MAX = R_MAX;
  window.gen_size = gen_size;
  window.gen_int = gen_int;
}
