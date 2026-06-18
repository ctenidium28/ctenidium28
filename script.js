"use strict";

// ------------------------------------------------------------
// gen_size.py 相当の定数
// ------------------------------------------------------------

const R_MAX = 17;

const TEN_POW_BIG = Array.from(
  { length: R_MAX },
  (_, r) => 10n ** BigInt(r)
);

const HEX_POW_BIG = Array.from(
  { length: R_MAX },
  (_, r) => 16n ** BigInt(r)
);

// Python:
// POW10_SHIFT = tuple(Decimal(10) ** r for r in range(1 - r_max, r_max))
const POW10_SHIFT = [];
for (let r = 1 - R_MAX; r < R_MAX; r++) {
  POW10_SHIFT.push(r);
}

// Python:
// POW2_SHIFT = tuple(Decimal(2) ** r for r in range(1 - r_max, 0))
const POW2_SHIFT = [];
for (let r = 1 - R_MAX; r < 0; r++) {
  POW2_SHIFT.push(r);
}


// ------------------------------------------------------------
// ユーティリティ
// ------------------------------------------------------------

function is2pow(n) {
  if (!Number.isInteger(n) || n < 0) return false;
  if (n === 0) return true;

  while (n % 2 === 0) {
    n /= 2;
  }
  return n === 1;
}

function bitLength(n) {
  if (n <= 0) return 0;
  return Math.floor(Math.log2(n)) + 1;
}

function size2int(size) {
  if (size <= 0) return 1;

  const exp = 4 * bitLength(size);

  // JavaScript の Number で安全に整数として扱える範囲を超えると、
  // range ループ自体が現実的でなくなるので明示的に止める。
  if (exp > 52) {
    throw new RangeError(
      `size2int(${size}) = 2^${exp} + 1 は JavaScript の安全整数範囲を超えます`
    );
  }

  return 2 ** exp + 1;
}

function minBigIntAsNumber(aNumber, bBigInt) {
  const aBigInt = BigInt(aNumber);
  const m = bBigInt < aBigInt ? bBigInt : aBigInt;

  if (m > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("ループ回数が JavaScript の安全整数範囲を超えました");
  }

  return Number(m);
}


// ------------------------------------------------------------
// Decimal 風の 10 進値表現
//
// Python 版の gen_size_dec は Decimal を返す。
// JavaScript には標準 Decimal がないため、
// 内部では coeff * 10^exp という形で保持する。
// 最終的に gen_size では Number に変換する。
// ------------------------------------------------------------

function normalizeDec(coeff, exp) {
  if (coeff === 0n) return null;

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

function decToNumber(v) {
  return Number(`${v.coeff.toString()}e${v.exp}`);
}

function decMulPow10ToNumber(v, shift) {
  return Number(`${v.coeff.toString()}e${v.exp + shift}`);
}


// ------------------------------------------------------------
// Python の lru_cache(maxsize=None) 相当
// ------------------------------------------------------------

const decPairsCache = new Map();
const hexPairsCache = new Map();

const genSizeDecCache = new Map();
const genSizeHexCache = new Map();
const genSizeCache = new Map();


// ------------------------------------------------------------
// _dec_pairs(size)
// ------------------------------------------------------------

function decPairs(size) {
  if (decPairsCache.has(size)) {
    return decPairsCache.get(size);
  }

  const out = [];

  for (let a = 0; a <= size; a++) {
    if (is2pow(a) && is2pow(size - a)) {
      out.push([a, size - a]);
    }
  }

  decPairsCache.set(size, out);
  return out;
}


// ------------------------------------------------------------
// _hex_pairs(size)
// ------------------------------------------------------------

function hexPairs(size) {
  if (hexPairsCache.has(size)) {
    return hexPairsCache.get(size);
  }

  const out = [];

  for (let a = 1; a < size; a++) {
    if (is2pow(a) && is2pow(size - a)) {
      out.push([a, size - a]);
    }
  }

  if (size >= 1 && is2pow(size - 1)) {
    out.push([0, size - 1]);
  }

  hexPairsCache.set(size, out);
  return out;
}


// ------------------------------------------------------------
// _gen_size_dec_cached(size)
// Python 版では frozenset[Decimal]
// JS 版では Array<{ coeff: BigInt, exp: number, key: string }>
// ------------------------------------------------------------

function genSizeDecCached(size) {
  if (genSizeDecCache.has(size)) {
    return genSizeDecCache.get(size);
  }

  const seen = new Map();

  for (const [leftSize, rightSize] of decPairs(size)) {
    const P = size2int(leftSize);
    const Q = size2int(rightSize);

    for (let r = 0; r < R_MAX; r++) {
      const stepBig = TEN_POW_BIG[r];

      for (let p = 0; p < P; p++) {
        const qCount = minBigIntAsNumber(
          Q,
          BigInt(P - p) * stepBig
        );

        const base = BigInt(p) * stepBig;

        for (let q = 0; q < qCount; q++) {
          const num = base + BigInt(q);

          if (num !== 0n) {
            addDec(seen, num, -r);
            addDec(seen, -num, -r);
          }
        }
      }
    }
  }

  const result = Array.from(seen.values());
  genSizeDecCache.set(size, result);
  return result;
}


// ------------------------------------------------------------
// _gen_size_hex_cached(size)
// Python 版では frozenset[Decimal]
// JS 版では最終的な float 相当として Set<number>
// ------------------------------------------------------------

function genSizeHexCached(size) {
  if (genSizeHexCache.has(size)) {
    return genSizeHexCache.get(size);
  }

  const seen = new Set();

  for (const [leftSize, rightSize] of hexPairs(size)) {
    const P = size2int(leftSize);
    const Q = size2int(rightSize);

    for (let r = 0; r < R_MAX; r++) {
      const stepBig = HEX_POW_BIG[r];
      const scale = 16 ** (-r);

      for (let p = 0; p < P; p++) {
        const qCount = minBigIntAsNumber(
          Q,
          BigInt(P - p) * stepBig
        );

        for (let q = 0; q < qCount; q++) {
          const val = p + q * scale;

          if (val !== 0) {
            seen.add(val);
            seen.add(-val);
          }
        }
      }
    }
  }

  genSizeHexCache.set(size, seen);
  return seen;
}


// ------------------------------------------------------------
// _gen_size_cached(size)
// Python 版では frozenset[float]
// JS 版では Set<number>
// ------------------------------------------------------------

function genSizeCached(size) {
  if (genSizeCache.has(size)) {
    return genSizeCache.get(size);
  }

  const seen = new Set();

  function addNumber(x) {
    if (x !== 0) {
      seen.add(x);
    }
  }

  // decimal 本体
  for (const a of genSizeDecCached(size)) {
    addNumber(decToNumber(a));
  }

  // decimal を 10^r 倍
  for (const shift of POW10_SHIFT) {
    for (const p of genSizeDecCached(size - 1)) {
      addNumber(decMulPow10ToNumber(p, shift));
    }
  }

  // hex 本体
  for (const a of genSizeHexCached(size)) {
    addNumber(a);
  }

  // hex を 2^r 倍
  for (const shift of POW2_SHIFT) {
    const scale = 2 ** shift;

    for (const p of genSizeHexCached(size - 2)) {
      addNumber(p * scale);
    }
  }

  // pi 追加
  if (size >= 1) {
    seen.add(Math.PI);
  }

  if (size >= 2) {
    seen.add(-Math.PI);
  }

  // Python の seen.discard(0.0) 相当
  seen.delete(0);

  genSizeCache.set(size, seen);
  return seen;
}


// ------------------------------------------------------------
// 公開関数 gen_size(size)
//
// Python:
// def gen_size(size: int) -> set:
//     return set(_gen_size_cached(size))
//
// JS:
// キャッシュ本体は共有しつつ、呼び出しごとに新しい Set を返す。
// ------------------------------------------------------------

function gen_size(size) {
  return new Set(genSizeCached(size));
}


// ------------------------------------------------------------
// UI 用
// ------------------------------------------------------------

function randomSampleFromSet(set, k) {
  const arr = Array.from(set);
  const n = arr.length;
  const m = Math.min(k, n);

  for (let i = 0; i < m; i++) {
    const j = i + Math.floor(Math.random() * (n - i));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }

  return arr.slice(0, m);
}

function formatNumber(x) {
  if (Object.is(x, -0)) return "-0";
  return String(x);
}

const sizeInput = document.getElementById("sizeInput");
const runButton = document.getElementById("runButton");
const statusEl = document.getElementById("status");
const outputEl = document.getElementById("output");

runButton.addEventListener("click", () => {
  const size = Number(sizeInput.value);

  if (!Number.isInteger(size)) {
    statusEl.textContent = "整数を入力してください。";
    outputEl.textContent = "";
    return;
  }

  statusEl.textContent = "計算中...";
  outputEl.textContent = "";

  // 先に「計算中」を描画させるために 1 回イベントループへ戻す
  setTimeout(() => {
    const t0 = performance.now();

    try {
      const values = gen_size(size);
      const sample = randomSampleFromSet(values, 10);
      const t1 = performance.now();

      statusEl.textContent =
        `size=${size}, 個数=${values.size}, ` +
        `計算時間=${(t1 - t0).toFixed(1)} ms`;

      outputEl.textContent = sample.map(formatNumber).join("\n");
    } catch (e) {
      statusEl.textContent = "エラーが発生しました。";
      outputEl.textContent = String(e && e.stack ? e.stack : e);
    }
  }, 0);
});
