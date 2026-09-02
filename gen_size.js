"use strict";

// ------------------------------------------------------------
// Parameters
// ------------------------------------------------------------

const MAX_SCAN_SIZE = 4;

let MAX_DECIMAL_FRACTION_DIGITS = 17;
let MAX_HEX_FRACTION_DIGITS = 17;


// ------------------------------------------------------------
// Token cost
// ------------------------------------------------------------

function is_2pow(n) {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}


function bitLength(n) {
  if (n <= 0) {
    return 0;
  }
  return Math.floor(Math.log2(n)) + 1;
}


function size2int(size) {
  return size > 0 ? (2 ** (4 * bitLength(size))) + 1 : 1;
}


const INT_TOKEN_SIZE_CACHE = new Map();

function intTokenSize(n) {
  n = typeof n === "bigint" ? n : BigInt(n);
  if (n < 0n) {
    n = -n;
  }

  const key = n.toString();
  const cached = INT_TOKEN_SIZE_CACHE.get(key);
  if (cached !== undefined) {
    return cached;
  }

  let size = 1;

  while (n >= BigInt(size2int(size))) {
    size *= 2;
  }

  INT_TOKEN_SIZE_CACHE.set(key, size);
  return size;
}


const COMPONENT_VALUES_CACHE = new Map();

function componentValues(size) {
  if (COMPONENT_VALUES_CACHE.has(size)) {
    return COMPONENT_VALUES_CACHE.get(size);
  }

  if (!is_2pow(size)) {
    const out = Object.freeze([]);
    COMPONENT_VALUES_CACHE.set(size, out);
    return out;
  }

  const upper = size2int(size);
  const lower = size === 1 ? 0 : size2int(size / 2);
  const out = [];

  for (let n = lower; n < upper; n++) {
    out.push(n);
  }

  Object.freeze(out);
  COMPONENT_VALUES_CACHE.set(size, out);
  return out;
}


function decimalComponentCost(digits, emptyCost) {
  if (digits === "") {
    return emptyCost;
  }
  return intTokenSize(BigInt(digits));
}


function hexComponentValue(digits) {
  return digits === "" ? 0n : BigInt(`0x${digits}`);
}


function hexComponentCost(digits) {
  return intTokenSize(hexComponentValue(digits));
}


function literalTokenSize(text) {
  let s = String(text).trim();

  if (SPECIAL_CONSTANT_MAP.has(s)) {
    return 1;
  }

  if (s.startsWith("+") || s.startsWith("-")) {
    s = s.slice(1);
  }

  const lower = s.toLowerCase();

  if (lower.startsWith("0x")) {
    let body = s.slice(2);
    const lowerBody = body.toLowerCase();
    const pPos = lowerBody.indexOf("p");

    let exponent = null;
    let explicitPlus = false;

    if (pPos !== -1) {
      let expText = body.slice(pPos + 1);
      body = body.slice(0, pPos);

      if (expText.startsWith("+")) {
        explicitPlus = true;
        expText = expText.slice(1);
      }

      exponent = Number(expText);
    }

    let cost;

    if (body.includes(".")) {
      const [left, right] = body.split(".", 2);
      const leftCost = hexComponentCost(left);
      const rightValue = hexComponentValue(right);
      const rightCost = intTokenSize(rightValue);

      if (exponent === null) {
        cost = leftCost + rightCost;
      } else if (exponent < 0) {
        cost =
          leftCost +
          rightCost +
          1 +
          intTokenSize(-exponent);
      } else {
        cost =
          leftCost +
          intTokenSize(rightValue << BigInt(exponent));
      }
    } else {
      const value = hexComponentValue(body);
      const baseCost = intTokenSize(value);

      if (exponent === null) {
        cost = baseCost;
      } else if (exponent < 0) {
        cost =
          baseCost +
          1 +
          intTokenSize(-exponent);
      } else {
        cost = intTokenSize(value << BigInt(exponent));
      }
    }

    if (explicitPlus) {
      cost += 2;
    }

    return cost;
  }

  const ePos = lower.indexOf("e");
  let exponent = null;
  let explicitPlus = false;

  if (ePos !== -1) {
    let expText = s.slice(ePos + 1);
    s = s.slice(0, ePos);

    if (expText.startsWith("+")) {
      explicitPlus = true;
      expText = expText.slice(1);
    }

    exponent = Number(expText);
  }

  let cost;

  if (s.includes(".")) {
    const [left, right] = s.split(".", 2);
    cost =
      decimalComponentCost(left, 0) +
      decimalComponentCost(right, 1);
  } else {
    cost = intTokenSize(BigInt(s));
  }

  if (exponent !== null) {
    cost += intTokenSize(Math.abs(exponent));

    if (explicitPlus) {
      cost += 2;
    }
  }

  return cost;
}


// ------------------------------------------------------------
// Semantic identity
// ------------------------------------------------------------

const FLOAT_KEY_BUFFER = new ArrayBuffer(8);
const FLOAT_KEY_VIEW = new DataView(FLOAT_KEY_BUFFER);

function valueKey(value) {
  if (typeof value === "bigint") {
    return `int:${value.toString()}`;
  }

  if (typeof value === "number") {
    FLOAT_KEY_VIEW.setFloat64(0, value, false);
    const hi = FLOAT_KEY_VIEW.getUint32(0, false).toString(16).padStart(8, "0");
    const lo = FLOAT_KEY_VIEW.getUint32(4, false).toString(16).padStart(8, "0");
    return `float:${hi}${lo}`;
  }

  throw new TypeError(`unsupported literal value: ${String(value)}`);
}


function betterText(newText, oldText) {
  return (
    newText.length < oldText.length ||
    (newText.length === oldText.length && newText < oldText)
  );
}


function addCandidate(out, text, tokenSize) {
  if (literalTokenSize(text) !== tokenSize) {
    throw new Error(`token mismatch: ${text}`);
  }

  let value;

  try {
    value = luaLiteralValue(text);
  } catch {
    return;
  }

  if (typeof value !== "bigint" && typeof value !== "number") {
    return;
  }

  const key = valueKey(value);
  const old = out.get(key);

  if (old === undefined || betterText(text, old[0])) {
    out.set(key, [text, value]);
  }
}


function addSigned(out, text, tokenSize) {
  addCandidate(out, text, tokenSize);
  addCandidate(out, `-${text}`, tokenSize);
}


// ------------------------------------------------------------
// Decimal fixed notation
// ------------------------------------------------------------

const DECIMAL_UNSIGNED_MANTISSAS_CACHE = new Map();

function decimalUnsignedMantissas(tokenSize) {
  if (DECIMAL_UNSIGNED_MANTISSAS_CACHE.has(tokenSize)) {
    return DECIMAL_UNSIGNED_MANTISSAS_CACHE.get(tokenSize);
  }

  const out = new Set();

  for (const n of componentValues(tokenSize)) {
    out.add(String(n));
  }

  for (const q of componentValues(tokenSize)) {
    if (q === 0) {
      if (tokenSize === 1) {
        out.add(".0");
      }
      continue;
    }

    if (q % 10 === 0) {
      continue;
    }

    const digits = String(q);
    let z = 0;

    while (z + digits.length <= MAX_DECIMAL_FRACTION_DIGITS) {
      const text = "." + "0".repeat(z) + digits;
      const value = Number(text);

      if (value === 0) {
        break;
      }

      out.add(text);
      z++;
    }
  }

  for (let leftSize = 1; leftSize < tokenSize; leftSize++) {
    const rightSize = tokenSize - leftSize;

    if (!is_2pow(leftSize) || !is_2pow(rightSize)) {
      continue;
    }

    for (const p of componentValues(leftSize)) {
      if (p === 0) {
        continue;
      }

      for (const q of componentValues(rightSize)) {
        if (q === 0 || q % 10 === 0) {
          continue;
        }

        const digits = String(q);
        const base = Number(p);
        let z = 0;

        while (true) {
          const text = `${p}.` + "0".repeat(z) + digits;
          const value = Number(text);

          if (value === base) {
            break;
          }

          out.add(text);
          z++;
        }
      }
    }
  }

  const result = Array.from(out);
  result.sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  Object.freeze(result);
  DECIMAL_UNSIGNED_MANTISSAS_CACHE.set(tokenSize, result);
  return result;
}


function generateDecimalFixed(out, tokenSize) {
  for (const text of decimalUnsignedMantissas(tokenSize)) {
    addSigned(out, text, tokenSize);
  }
}


// ------------------------------------------------------------
// Decimal exponent notation
// ------------------------------------------------------------

function generateDecimalExponent(out, tokenSize) {
  for (let exponentSize = 1; exponentSize < tokenSize; exponentSize++) {
    const mantissaSize = tokenSize - exponentSize;

    if (!is_2pow(exponentSize)) {
      continue;
    }

    const mantissas = decimalUnsignedMantissas(mantissaSize);

    for (const exponent of componentValues(exponentSize)) {
      const exponentTexts =
        exponent === 0
          ? ["0"]
          : [String(exponent), `-${exponent}`];

      for (const mantissa of mantissas) {
        if (Number(mantissa) === 0) {
          continue;
        }

        for (const expText of exponentTexts) {
          const text = `${mantissa}e${expText}`;
          addSigned(out, text, tokenSize);
        }
      }
    }
  }
}


// ------------------------------------------------------------
// Hex integer / fixed notation
// ------------------------------------------------------------

function generateHexInteger(out, tokenSize) {
  for (const n of componentValues(tokenSize)) {
    addSigned(out, `0x${n.toString(16).toUpperCase()}`, tokenSize);
  }
}


function* iterHexFractionTexts(q) {
  if (q === 0) {
    yield "0";
    return;
  }

  if (q % 16 === 0) {
    return;
  }

  const digits = q.toString(16).toUpperCase();
  let z = 0;

  while (true) {
    yield "0".repeat(z) + digits;
    z++;
  }
}


function generateHexFixed(out, tokenSize) {
  const rightSize = tokenSize - 1;

  if (is_2pow(rightSize)) {
    for (const q of componentValues(rightSize)) {
      if (q === 0) {
        continue;
      }

      for (const frac of iterHexFractionTexts(q)) {
        if (frac.length > MAX_HEX_FRACTION_DIGITS) {
          break;
        }

        const text = `0x.${frac}`;
        let value;

        try {
          value = luaLiteralValue(text);
        } catch {
          break;
        }

        if (value === 0) {
          break;
        }

        addSigned(out, text, tokenSize);
      }
    }
  }

  for (let leftSize = 1; leftSize < tokenSize; leftSize++) {
    const rightSize2 = tokenSize - leftSize;

    if (!is_2pow(leftSize) || !is_2pow(rightSize2)) {
      continue;
    }

    for (const p of componentValues(leftSize)) {
      if (p === 0) {
        continue;
      }

      const left = p.toString(16).toUpperCase();
      const base = Number(p);

      for (const q of componentValues(rightSize2)) {
        if (q === 0) {
          continue;
        }

        for (const frac of iterHexFractionTexts(q)) {
          if (frac.length > MAX_HEX_FRACTION_DIGITS) {
            break;
          }

          const text = `0x${left}.${frac}`;
          let value;

          try {
            value = luaLiteralValue(text);
          } catch {
            break;
          }

          if (value === base) {
            break;
          }

          addSigned(out, text, tokenSize);
        }
      }
    }
  }
}


// ------------------------------------------------------------
// Hex p notation without decimal point
// ------------------------------------------------------------

function generateHexPNoDot(out, tokenSize) {
  const upper = size2int(tokenSize);

  for (let n = 0; n < upper; n++) {
    if (n === 0) {
      if (tokenSize === 1) {
        addSigned(out, "0x0p0", tokenSize);
      }
      continue;
    }

    let exponent = 0;

    while (true) {
      const shifted = BigInt(n) << BigInt(exponent);
      const cost = intTokenSize(shifted);

      if (cost > tokenSize) {
        break;
      }

      if (cost === tokenSize) {
        const text = `0x${n.toString(16).toUpperCase()}p${exponent}`;
        addSigned(out, text, tokenSize);
      }

      exponent++;
    }
  }

  for (let bodySize = 1; bodySize < tokenSize - 1; bodySize++) {
    const exponentSize = tokenSize - bodySize - 1;

    if (!is_2pow(bodySize) || !is_2pow(exponentSize)) {
      continue;
    }

    for (const n of componentValues(bodySize)) {
      for (const exponent of componentValues(exponentSize)) {
        if (exponent === 0) {
          continue;
        }

        const text =
          `0x${n.toString(16).toUpperCase()}p-${exponent}`;
        addSigned(out, text, tokenSize);
      }
    }
  }
}


// ------------------------------------------------------------
// Hex dotted p notation: p >= 0
// ------------------------------------------------------------

function generateHexPDotNonnegative(out, tokenSize) {
  for (let leftSize = 1; leftSize < tokenSize; leftSize++) {
    const shiftedRightSize = tokenSize - leftSize;

    if (!is_2pow(leftSize) || !is_2pow(shiftedRightSize)) {
      continue;
    }

    for (const leftValue of componentValues(leftSize)) {
      const left =
        leftValue === 0
          ? ""
          : leftValue.toString(16).toUpperCase();

      if (shiftedRightSize === 1 && leftValue !== 0) {
        let exponent = 1;

        while (true) {
          const text = `0x${left}.p${exponent}`;
          let value;

          try {
            value = luaLiteralValue(text);
          } catch {
            break;
          }

          if (!Number.isFinite(value)) {
            break;
          }

          addSigned(out, text, tokenSize);
          exponent++;
        }
      }

      const rightUpper = size2int(shiftedRightSize);

      for (let q = 1; q < rightUpper; q++) {
        if (q % 16 === 0) {
          continue;
        }

        let exponent = 0;

        while (true) {
          const shifted = BigInt(q) << BigInt(exponent);
          const cost = intTokenSize(shifted);

          if (cost > shiftedRightSize) {
            break;
          }

          if (cost === shiftedRightSize) {
            const base = Number(leftValue) * (2 ** exponent);

            for (const frac of iterHexFractionTexts(q)) {
              if (frac.length > MAX_HEX_FRACTION_DIGITS) {
                break;
              }

              const text = `0x${left}.${frac}p${exponent}`;
              let value;

              try {
                value = luaLiteralValue(text);
              } catch {
                break;
              }

              if (!Number.isFinite(value)) {
                break;
              }

              if (value === base) {
                break;
              }

              addSigned(out, text, tokenSize);
            }
          }

          exponent++;
        }
      }
    }
  }
}


// ------------------------------------------------------------
// Hex dotted p notation: p < 0
// ------------------------------------------------------------

function generateHexPDotNegative(out, tokenSize) {
  for (let leftSize = 1; leftSize < tokenSize; leftSize++) {
    for (
      let rightSize = 1;
      rightSize < tokenSize - leftSize;
      rightSize++
    ) {
      const exponentSize =
        tokenSize - leftSize - rightSize - 1;

      if (exponentSize < 1) {
        continue;
      }

      if (
        !is_2pow(leftSize) ||
        !is_2pow(rightSize) ||
        !is_2pow(exponentSize)
      ) {
        continue;
      }

      for (const leftValue of componentValues(leftSize)) {
        const left =
          leftValue === 0
            ? ""
            : leftValue.toString(16).toUpperCase();

        for (const q of componentValues(rightSize)) {
          for (const exponent of componentValues(exponentSize)) {
            if (exponent === 0) {
              continue;
            }

            const base =
              Number(leftValue) * (2 ** (-exponent));
            const fracTexts =
              q === 0
                ? ["0"]
                : iterHexFractionTexts(q);

            for (const frac of fracTexts) {
              if (frac.length > MAX_HEX_FRACTION_DIGITS) {
                break;
              }

              const text =
                `0x${left}.${frac}p-${exponent}`;
              let value;

              try {
                value = luaLiteralValue(text);
              } catch {
                break;
              }

              if (!Number.isFinite(value)) {
                break;
              }

              if (value === base) {
                break;
              }

              addSigned(out, text, tokenSize);
            }
          }
        }
      }
    }
  }
}


// ------------------------------------------------------------
// Special constants
// ------------------------------------------------------------

function generateSpecialConstants(out, tokenSize) {
  if (tokenSize !== 1) {
    return;
  }

  for (const [text] of SPECIAL_CONSTANTS) {
    addCandidate(out, text, 1);
  }
}


// ------------------------------------------------------------
// Raw candidates
// ------------------------------------------------------------

const RAW_CANDIDATES_CACHE = new Map();

function rawCandidates(tokenSize) {
  if (RAW_CANDIDATES_CACHE.has(tokenSize)) {
    return RAW_CANDIDATES_CACHE.get(tokenSize);
  }

  const out = new Map();

  generateDecimalFixed(out, tokenSize);
  generateDecimalExponent(out, tokenSize);
  generateHexInteger(out, tokenSize);
  generateHexFixed(out, tokenSize);
  generateHexPNoDot(out, tokenSize);
  generateHexPDotNonnegative(out, tokenSize);
  generateHexPDotNegative(out, tokenSize);
  generateSpecialConstants(out, tokenSize);

  RAW_CANDIDATES_CACHE.set(tokenSize, out);
  return out;
}


// ------------------------------------------------------------
// Public gen_size
// ------------------------------------------------------------

const GEN_SIZE_CACHE = new Map();

function genSizeCached(tokenSize) {
  if (GEN_SIZE_CACHE.has(tokenSize)) {
    return GEN_SIZE_CACHE.get(tokenSize);
  }

  if (tokenSize < 1) {
    return [];
  }

  if (tokenSize > MAX_SCAN_SIZE) {
    throw new RangeError(
      `gen_size only supports sizes 1..${MAX_SCAN_SIZE}; got ${tokenSize}`
    );
  }

  const cur = new Map(rawCandidates(tokenSize));

  for (let smaller = 1; smaller < tokenSize; smaller++) {
    for (const [, value] of genSizeCached(smaller)) {
      cur.delete(valueKey(value));
    }
  }

  const out = Array.from(cur.values());
  out.sort((a, b) =>
    a[0].length - b[0].length ||
    (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
  );

  Object.freeze(out);
  GEN_SIZE_CACHE.set(tokenSize, out);
  return out;
}


function gen_size(tokenSize) {
  return genSizeCached(tokenSize);
}


// ------------------------------------------------------------
// Integer-only shell
// ------------------------------------------------------------

const GEN_INT_CACHE = new Map();

function gen_int(tokenSize) {
  if (GEN_INT_CACHE.has(tokenSize)) {
    return GEN_INT_CACHE.get(tokenSize);
  }

  if (!is_2pow(tokenSize)) {
    const out = Object.freeze([]);
    GEN_INT_CACHE.set(tokenSize, out);
    return out;
  }

  const upper = size2int(tokenSize);
  const out = [];

  if (tokenSize === 1) {
    for (let x = 1 - upper; x < upper; x++) {
      out.push(BigInt(x));
    }
  } else {
    const lower = size2int(tokenSize / 2);

    for (let x = 1 - upper; x < 1 - lower; x++) {
      out.push(BigInt(x));
    }

    for (let x = lower; x < upper; x++) {
      out.push(BigInt(x));
    }
  }

  Object.freeze(out);
  GEN_INT_CACHE.set(tokenSize, out);
  return out;
}


// ------------------------------------------------------------
// Configuration / cache
// ------------------------------------------------------------

function clearGenSizeCaches() {
  INT_TOKEN_SIZE_CACHE.clear();
  COMPONENT_VALUES_CACHE.clear();
  DECIMAL_UNSIGNED_MANTISSAS_CACHE.clear();
  RAW_CANDIDATES_CACHE.clear();
  GEN_SIZE_CACHE.clear();
  GEN_INT_CACHE.clear();
}


function configureGenSize({
  maxDecimalFractionDigits = MAX_DECIMAL_FRACTION_DIGITS,
  maxHexFractionDigits = MAX_HEX_FRACTION_DIGITS,
} = {}) {
  if (
    !Number.isInteger(maxDecimalFractionDigits) ||
    maxDecimalFractionDigits < 1
  ) {
    throw new RangeError(
      "maxDecimalFractionDigits must be a positive integer"
    );
  }

  if (
    !Number.isInteger(maxHexFractionDigits) ||
    maxHexFractionDigits < 1
  ) {
    throw new RangeError(
      "maxHexFractionDigits must be a positive integer"
    );
  }

  if (
    maxDecimalFractionDigits === MAX_DECIMAL_FRACTION_DIGITS &&
    maxHexFractionDigits === MAX_HEX_FRACTION_DIGITS
  ) {
    return;
  }

  MAX_DECIMAL_FRACTION_DIGITS = maxDecimalFractionDigits;
  MAX_HEX_FRACTION_DIGITS = maxHexFractionDigits;

  clearGenSizeCaches();

  globalThis.MAX_DECIMAL_FRACTION_DIGITS =
    MAX_DECIMAL_FRACTION_DIGITS;
  globalThis.MAX_HEX_FRACTION_DIGITS =
    MAX_HEX_FRACTION_DIGITS;
}


// ------------------------------------------------------------
// Browser / Web Worker globals
// ------------------------------------------------------------

Object.assign(globalThis, {
  MAX_SCAN_SIZE,
  MAX_DECIMAL_FRACTION_DIGITS,
  MAX_HEX_FRACTION_DIGITS,
  size2int,
  intTokenSize,
  literalTokenSize,
  gen_size,
  gen_int,
  configureGenSize,
  clearGenSizeCaches,
});
