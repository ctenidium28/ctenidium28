"use strict";

// gen_size.py の r_max と同じ値。
// gen_size.js 側で R_MAX が定義済みならそれを使う。
const FLOAT_FORMAT_R_MAX =
  typeof R_MAX !== "undefined" ? R_MAX : 17;


// ------------------------------------------------------------
// string utilities
// ------------------------------------------------------------

function isAllZeros(s) {
  s = String(s);
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "0") return false;
  }
  return true;
}

function stripLeadingZeros(s) {
  return String(s).replace(/^0+/, "");
}

function stripTrailingZeros(s) {
  return String(s).replace(/0+$/, "");
}

function stripTrailingZerosAndDot(s) {
  s = String(s).replace(/0+$/, "");
  if (s.endsWith(".")) s = s.slice(0, -1);
  return s;
}

function hasNonZeroFraction(frac) {
  for (let i = 0; i < frac.length; i++) {
    if (frac[i] !== "0") return true;
  }
  return false;
}


// ------------------------------------------------------------
// int2size 相当
// Python:
//   0..16       -> 1
//   17..256     -> 2
//   257..4096   -> 4
//   4097..65536 -> 8
// ------------------------------------------------------------

const int2SizeCache = new Map();

function bitLengthBigInt(n) {
  if (n <= 0n) return 0;
  return n.toString(2).length;
}

function toBigIntInteger(x) {
  if (typeof x === "bigint") {
    return x;
  }

  if (typeof x === "number") {
    if (!Number.isFinite(x)) {
      throw new RangeError("int2size received a non-finite number");
    }
    return BigInt(Math.trunc(x));
  }

  const s = String(x);
  if (s === "" || isAllZeros(s)) {
    return 0n;
  }

  return BigInt(s);
}

function int2size(x, v0) {
  if (
    (typeof x === "number" && x === 0) ||
    (typeof x === "bigint" && x === 0n) ||
    (typeof x === "string" && isAllZeros(x))
  ) {
    return v0;
  }

  const key = `${v0}|${String(x)}`;
  const cached = int2SizeCache.get(key);
  if (cached !== undefined) return cached;

  const n = toBigIntInteger(x);

  let result;

  if (n <= 1n) {
    result = 1;
  } else {
    const bl = bitLengthBigInt(n - 1n);
    const exp = Math.floor((bl - 1) / 4);
    result = 2 ** exp;
  }

  int2SizeCache.set(key, result);
  return result;
}


// ------------------------------------------------------------
// hex token size
// ------------------------------------------------------------

function hexFracSize(s) {
  s = stripLeadingZeros(String(s));

  if (s === "") {
    return 0;
  }

  return 2 ** (s.length - 1);
}

function hexTokenSize(hexIntDec, hexFrac) {
  return int2size(hexIntDec, 1) + hexFracSize(hexFrac);
}


// ------------------------------------------------------------
// Hex helpers
// ------------------------------------------------------------

function roundUpHexParts(hexInt, hexFrac) {
  let intPart = String(hexInt).toUpperCase() || "0";
  const fracPart = String(hexFrac).toUpperCase();

  let intLen = intPart.length;
  const digits = Array.from(intPart + fracPart);

  let carry = 1;

  for (let i = digits.length - 1; i >= 0; i--) {
    const v = parseInt(digits[i], 16) + carry;

    if (v < 16) {
      digits[i] = v.toString(16).toUpperCase();
      carry = 0;
      break;
    }

    digits[i] = "0";
  }

  if (carry) {
    digits.unshift("1");
    intLen += 1;
  }

  const newInt = digits.slice(0, intLen).join("").replace(/^0+/, "");
  const newFrac = digits.slice(intLen).join("");

  return [newInt, newFrac];
}

function makeHexLiteral(sign, hexInt, hexFrac) {
  const body = `${stripLeadingZeros(hexInt)}.${hexFrac}`.toUpperCase();
  return `${sign}0x${body}`;
}

function hexIntToDecimalString(hexInt) {
  if (!hexInt || isAllZeros(hexInt)) {
    return "0";
  }

  return BigInt("0x" + hexInt).toString(10);
}

function hexLiteralToFloat(s) {
  s = String(s).trim();

  let sign = 1;
  if (s.startsWith("-")) {
    sign = -1;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }

  if (!s.startsWith("0x") && !s.startsWith("0X")) {
    return Number(s) * sign;
  }

  const body = s.slice(2);
  const dot = body.indexOf(".");

  let intPart;
  let fracPart;

  if (dot === -1) {
    intPart = body;
    fracPart = "";
  } else {
    intPart = body.slice(0, dot);
    fracPart = body.slice(dot + 1);
  }

  const intValue =
    intPart === "" ? 0 : Number(BigInt("0x" + intPart));

  let fracValue = 0;
  let scale = 1 / 16;

  for (let i = 0; i < fracPart.length; i++) {
    fracValue += parseInt(fracPart[i], 16) * scale;
    scale /= 16;
  }

  return sign * (intValue + fracValue);
}


// ------------------------------------------------------------
// Number -> Decimal(str(x)) を format(..., "f") したような文字列へ
// ------------------------------------------------------------

function numberToPlainAbsString(x) {
  x = Math.abs(x);

  let s = String(x).toLowerCase();

  if (!s.includes("e")) {
    return s;
  }

  let [mant, expStr] = s.split("e");
  const exp = Number(expStr);

  let digits;
  let fracLen;

  const dot = mant.indexOf(".");
  if (dot === -1) {
    digits = mant;
    fracLen = 0;
  } else {
    digits = mant.slice(0, dot) + mant.slice(dot + 1);
    fracLen = mant.length - dot - 1;
  }

  digits = stripLeadingZeros(digits);
  if (digits === "") digits = "0";

  const newFracLen = fracLen - exp;

  if (newFracLen <= 0) {
    return digits + "0".repeat(-newFracLen);
  }

  if (newFracLen >= digits.length) {
    return "0." + "0".repeat(newFracLen - digits.length) + digits;
  }

  const intPart = digits.slice(0, digits.length - newFracLen);
  const decPart = digits.slice(digits.length - newFracLen);

  return intPart + "." + decPart;
}


// ------------------------------------------------------------
// 10進小数部分 -> 16進小数部分
//
// Python 版では Decimal("0."+d_dec) * Decimal(16) を使う。
// JS 版では、fracDigits / 10^len を BigInt の有理数として扱う。
// ------------------------------------------------------------

const hexFractionCache = new Map();

function decimalFractionToHexDigits(fracDigits, maxDigits = FLOAT_FORMAT_R_MAX) {
  fracDigits = String(fracDigits);

  const key = `${fracDigits}|${maxDigits}`;
  const cached = hexFractionCache.get(key);
  if (cached !== undefined) return cached;

  if (fracDigits.length === 0 || isAllZeros(fracDigits)) {
    hexFractionCache.set(key, "0");
    return "0";
  }

  let numerator = BigInt(fracDigits);
  const denominator = 10n ** BigInt(fracDigits.length);

  const out = [];

  for (let i = 0; i < maxDigits; i++) {
    numerator *= 16n;

    const digit = numerator / denominator;
    numerator %= denominator;

    out.push(digit.toString(16));

    if (numerator === 0n) {
      break;
    }
  }

  const result = out.join("");
  hexFractionCache.set(key, result);
  return result;
}


// ------------------------------------------------------------
// rep_format(token, x) 相当
//
// 互換用に repFormat(x) と呼ばれた場合は token = Infinity として扱う。
// ただし、16進誤差補正を使うには repFormat(token, x) と呼ぶ必要がある。
// ------------------------------------------------------------

function repFormat(token, x) {
  if (arguments.length === 1) {
    x = token;
    token = Infinity;
  }

  const d = numberToPlainAbsString(x);
  const sign = x < 0 || Object.is(x, -0) ? "-" : "";

  const candidates = [];

  function addCandidate(cost, text) {
    candidates.push([cost, text]);
  }

  // x が pi のとき
  if (d === String(Math.PI)) {
    return sign + "pi";
  }

  let decimalIntegerPartForHex = null;

  if (d.includes(".") && hasNonZeroFraction(d.slice(d.indexOf(".") + 1))) {
    const [dInt, dDec] = d.split(".");
    decimalIntegerPartForHex = dInt;

    // --------------------------------------------------------
    // 10進数表記
    // --------------------------------------------------------

    addCandidate(
      int2size(dInt, 0) + int2size(dDec, 0),
      sign + stripTrailingZerosAndDot(d.replace(/^0+/, ""))
    );

    // --------------------------------------------------------
    // 10進数指数表記
    // --------------------------------------------------------

    const s = dInt + dDec;
    const dot = d.indexOf(".");

    for (let i = 1; i < s.length; i++) {
      if (i === dot) continue;

      const left = stripLeadingZeros(s.slice(0, i));
      if (left === "") continue;

      const right = stripTrailingZeros(s.slice(i));
      const exp = dot - i;

      addCandidate(
        int2size(left, 0) +
          int2size(right, 0) +
          int2size(Math.abs(exp), 1),
        sign + left + (right ? "." + right : "") + "e" + String(exp)
      );
    }

    // --------------------------------------------------------
    // 16進数表記
    // --------------------------------------------------------

    const hexDec = decimalFractionToHexDigits(dDec, FLOAT_FORMAT_R_MAX);
    const hexInt = stripLeadingZeros(BigInt(dInt).toString(16));
    const hexRep = makeHexLiteral(sign, hexInt, hexDec);

    addCandidate(
      hexTokenSize(dInt, hexDec),
      hexRep
    );
  } else {
    let dIntOnly = d;

    if (dIntOnly.includes(".")) {
      dIntOnly = dIntOnly.slice(0, dIntOnly.indexOf("."));
    }

    // --------------------------------------------------------
    // 10進数表記
    // --------------------------------------------------------

    addCandidate(
      int2size(dIntOnly, 1),
      sign + dIntOnly
    );

    // --------------------------------------------------------
    // 10進数指数表記
    // --------------------------------------------------------

    for (let i = 1; i < dIntOnly.length; i++) {
      const left = dIntOnly.slice(0, i);
      const right = stripTrailingZeros(dIntOnly.slice(i));
      const exp = dIntOnly.length - i;

      addCandidate(
        int2size(left, 0) +
          int2size(right, 0) +
          int2size(exp, 1),
        sign + left + (right ? "." + right : "") + "e" + String(exp)
      );
    }
  }

  const tokenMin = Math.min(...candidates.map(m => m[0]));

  if (tokenMin <= token) {
    let best = null;

    for (const cand of candidates) {
      if (cand[0] !== tokenMin) continue;

      if (best === null || cand[1].length < best[1].length) {
        best = cand;
      }
    }

    return best[1];
  }

  // ----------------------------------------------------------
  // ここから下は、16進数表記の誤差補正
  // 生成過程から16進数表記は存在するとすればただひとつ、という前提。
  // ----------------------------------------------------------

  const fixedCandidates = [];

  for (const [cost, rep] of candidates) {
    if (!rep.includes("0x")) {
      continue;
    }

    const unsigned = sign ? rep.slice(sign.length) : rep;
    const body = unsigned.slice(2); // remove "0x"

    if (!body.includes(".")) {
      continue;
    }

    const [hexInt, hexFracFull] = body.split(".");

    for (let end = 1; end <= hexFracFull.length; end++) {
      const frac = hexFracFull.slice(0, end);

      // 切り捨て候補
      if (
        decimalIntegerPartForHex !== null &&
        hexTokenSize(decimalIntegerPartForHex, frac) === token
      ) {
        fixedCandidates.push(makeHexLiteral(sign, hexInt, frac));
      }

      // 切り上げ候補
      const [upInt, upFrac] = roundUpHexParts(hexInt, frac);
      const upIntDec = upInt ? hexIntToDecimalString(upInt) : "0";

      if (hexTokenSize(upIntDec, upFrac) === token) {
        fixedCandidates.push(makeHexLiteral(sign, upInt, upFrac));
      }
    }
  }

  if (fixedCandidates.length > 0) {
    let best = fixedCandidates[0];
    let bestDiff = Math.abs(hexLiteralToFloat(best) - Number(x));

    for (let i = 1; i < fixedCandidates.length; i++) {
      const cand = fixedCandidates[i];
      const diff = Math.abs(hexLiteralToFloat(cand) - Number(x));

      if (
        diff < bestDiff ||
        (diff === bestDiff && cand.length < best.length)
      ) {
        best = cand;
        bestDiff = diff;
      }
    }

    return best;
  }

  // 念のためのフォールバック。
  // token に合う16進補正候補を作れなかった場合。
  let fallback = candidates[0];

  for (let i = 1; i < candidates.length; i++) {
    const cand = candidates[i];

    if (
      cand[0] < fallback[0] ||
      (cand[0] === fallback[0] && cand[1].length < fallback[1].length)
    ) {
      fallback = cand;
    }
  }

  return fallback[1];
}
