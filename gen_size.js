"use strict";

// ------------------------------------------------------------
// Parameters
// ------------------------------------------------------------

const R_MAX = 17;

// gen_size is specialized for scan.
// It returns only positive shell candidates for sizes 1..4.
const MAX_SCAN_SIZE = 4;


// ------------------------------------------------------------
// Precomputed constants
// ------------------------------------------------------------

const DEC_SCALES = Array.from(
  { length: R_MAX },
  (_, r) => 10 ** (-r)
);

const TEN_POW = Array.from(
  { length: R_MAX },
  (_, r) => 10 ** r
);

const HEX_SCALES = Array.from(
  { length: R_MAX },
  (_, r) => 16 ** (-r)
);

const HEX_POW = Array.from(
  { length: R_MAX },
  (_, r) => 16 ** r
);

const POW10_SHIFT = Array.from(
  { length: 2 * R_MAX - 1 },
  (_, i) => 10 ** (1 - R_MAX + i)
);

const POW2_SHIFT = Array.from(
  { length: R_MAX - 1 },
  (_, i) => 2 ** (1 - R_MAX + i)
);


// ------------------------------------------------------------
// Basic size utilities
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


// ------------------------------------------------------------
// Small cache helper
// ------------------------------------------------------------

function getCached(cache, key, build) {
  if (cache.has(key)) {
    return cache.get(key);
  }

  const value = build();
  cache.set(key, value);
  return value;
}


// ------------------------------------------------------------
// Pair generation
// ------------------------------------------------------------

const DEC_PAIRS_CACHE = new Map();
const HEX_PAIRS_CACHE = new Map();

function decPairs(size) {
  return getCached(DEC_PAIRS_CACHE, size, () => {
    if (size < 0) {
      return [];
    }

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
    if (size < 0) {
      return [];
    }

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
// Python 版の _gen_size_dec_positive_cached(size) 相当。
// Decimal は使わず、最終的に float 化される値を Number として直接作る。
// ------------------------------------------------------------

const GEN_SIZE_DEC_POSITIVE_CACHE = new Map();

function genSizeDecPositiveCached(size) {
  return getCached(GEN_SIZE_DEC_POSITIVE_CACHE, size, () => {
    if (size < 0) {
      return new Set();
    }

    const out = new Set();

    for (const [leftSize, rightSize] of decPairs(size)) {
      const P = size2int(leftSize);
      const Q = size2int(rightSize);

      for (let r = 0; r < R_MAX; r++) {
        const step = TEN_POW[r];

        for (let p = 0; p < P; p++) {
          const qLim = Math.min(Q, (P - p) * step);

          for (let q = 0; q < qLim; q++) {
            if (p !== 0 || q !== 0) {
              // Python:
              //   Decimal(p * step + q) * Decimal(10) ** (-r)
              //
              // JS では p * step + q を先に作ると、
              // 大きい step で q が潰れやすいので、
              // p + q / step の形にする。
              out.add(p + q / step);
            }
          }
        }
      }
    }

    return out;
  });
}


// ------------------------------------------------------------
// Hex positive candidates
//
// Python 版の _gen_size_hex_positive_cached(size) 相当。
// 元仕様通り、p + q * 16^(-r) の形で作る。
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
      out.add(x);
    }

    // decimal shifted
    if (size - 1 >= 0) {
      for (const x of genSizeDecPositiveCached(size - 1)) {
        for (const scale of POW10_SHIFT) {
          const y = x * scale;
          if (y !== 0) {
            out.add(y);
          }
        }
      }
    }

    // hex body
    for (const x of genSizeHexPositiveCached(size)) {
      out.add(x);
    }

    // hex shifted
    if (size - 2 >= 0) {
      for (const x of genSizeHexPositiveCached(size - 2)) {
        for (const scale of POW2_SHIFT) {
          const y = x * scale;
          if (y !== 0) {
            out.add(y);
          }
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
// 重要:
//   この gen_size(size) は、旧 gen_size(size) ではなく、
//   旧 positive_shell(size) と同じ意味。
//
// つまり:
//   old positive_shell(t)
//     = old_gen_size(t) の正数のうち、old_gen_size(t - 1) にないもの
//
//   new gen_size(t)
//     = 上と同じ候補列
//
// 返り値は Array。
// 高速化のため cached array をそのまま返す。
// 呼び出し側では破壊的変更しないこと。
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
//
// 現状の scan.js では不要だが、古いコードが gen_int を参照しても
// 壊れないように残す。
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
      for (const scale of TEN_POW) {
        out.add(p * scale);
      }
    }

    return out;
  });
}

function gen_int(size) {
  return new Set(genIntCached(size));
}


// ------------------------------------------------------------
// Optional exports for browser global use
// ------------------------------------------------------------

if (typeof window !== "undefined") {
  window.R_MAX = R_MAX;
  window.gen_size = gen_size;
  window.gen_int = gen_int;
}
