"use strict";

// gen_size.py の r_max と同じ値
const FLOAT_FORMAT_R_MAX = 17;

// ------------------------------------------------------------
// int2size 相当
//
// Python:
// def int2size(x, v0) -> int:
//     return v0 if isinstance(x, int) and x == 0 or isinstance(x, str) and x.strip("0") == "" else 2**(len(format(int(x), "x"))-1)
// ------------------------------------------------------------

const int2SizeDigitsCache = new Map();

function isAllZeros(s) {
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "0") return false;
  }
  return true;
}

function stripLeadingZeros(s) {
  return s.replace(/^0+/, "");
}

function stripTrailingZeros(s) {
  return s.replace(/0+$/, "");
}

function stripTrailingZerosAndDot(s) {
  s = s.replace(/0+$/, "");
  if (s.endsWith(".")) s = s.slice(0, -1);
  return s;
}

function int2sizeDigits(s, v0) {
  s = String(s);

  const key = v0 + "|" + s;
  const cached = int2SizeDigitsCache.get(key);
  if (cached !== undefined) return cached;

  let result;

  if (s.length === 0 || isAllZeros(s)) {
    result = v0;
  } else {
    const t = stripLeadingZeros(s);
    const hexLen = BigInt(t).toString(16).length;
    result = 2 ** (hexLen - 1);
  }

  int2SizeDigitsCache.set(key, result);
  return result;
}

function int2sizeInt(n, v0) {
  n = Math.trunc(n);

  if (n === 0) return v0;

  const hexLen = n.toString(16).length;
  return 2 ** (hexLen - 1);
}


// ------------------------------------------------------------
// Number -> Decimal(str(x)) を format(..., "f") したような文字列へ
//
// Python:
// d = format(Decimal(str(x)).copy_abs(), "f")
//
// JS の Number#toString() は指数表記を返すことがあるため、
// 1e-7 -> 0.0000001 のように通常小数表記へ展開する。
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
// Python 版:
// hex_dec = ""
// for _ in range(gen_size.r_max):
//     p_int, p_dec = format(Decimal("0." + d_dec) * Decimal(16), "f").split(".")
//     hex_dec += format(int(p_int), "x")
//     if p_dec.strip("0") == "":
//         break
//     d_dec = p_dec
//
// JS 版:
// Decimal を使わず、
//   numerator / 10^len
// という有理数として BigInt で持つ。
// ------------------------------------------------------------

const hexFractionCache = new Map();

function decimalFractionToHexDigits(fracDigits, maxDigits = FLOAT_FORMAT_R_MAX) {
  const key = fracDigits + "|" + maxDigits;
  const cached = hexFractionCache.get(key);
  if (cached !== undefined) return cached;

  if (fracDigits.length === 0) {
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
// rep_format(x) 相当
// ------------------------------------------------------------

function repFormat(x) {
  // Python 版の:
  // if d == str(np.pi): return sign + "pi"
  //
  // gen_size 側では math.pi / -math.pi がそのまま入る前提なので、
  // 数値比較で先に処理する。
  if (x === Math.PI) return "pi";
  if (x === -Math.PI) return "-pi";

  const sign = x < 0 || Object.is(x, -0) ? "-" : "";
  const d = numberToPlainAbsString(x);

  let bestText = null;
  let bestCost = Infinity;

  function addCandidate(text, cost) {
    if (
      bestText === null ||
      cost < bestCost ||
      (cost === bestCost && text.length < bestText.length)
    ) {
      bestText = text;
      bestCost = cost;
    }
  }

  if (d.includes(".")) {
    const parts = d.split(".");
    const dInt = parts[0];
    const dDec = parts[1];

    // --------------------------------------------------------
    // 10進数表記
    //
    // Python:
    // sign + d.lstrip("0").rstrip("0").rstrip(".")
    // --------------------------------------------------------

    addCandidate(
      sign + stripTrailingZerosAndDot(d.replace(/^0+/, "")),
      int2sizeDigits(dInt, 0) + int2sizeDigits(dDec, 0)
    );

    // --------------------------------------------------------
    // 10進数指数表記
    //
    // Python:
    // s = d_int + d_dec
    // for i in range(1, len(s)):
    //     if i == d.find("."):
    //         continue
    // --------------------------------------------------------

    const s = dInt + dDec;
    const dot = dInt.length;

    for (let i = 1; i < s.length; i++) {
      if (i === dot) continue;

      const left = s.slice(0, i);
      const right = s.slice(i);
      const exp = dot - i;

      addCandidate(
        sign + stripLeadingZeros(left) + "." + right + "e" + String(exp),
        int2sizeDigits(left, 0) +
          int2sizeDigits(right, 0) +
          int2sizeInt(Math.abs(exp), 1)
      );
    }

    // --------------------------------------------------------
    // 16進数表記
    //
    // Python:
    // sign + "0x" + (format(int(d_int), "x").lstrip("0") + "." + hex_dec).upper()
    // --------------------------------------------------------

    const hexIntRaw = BigInt(dInt).toString(16);
    const hexInt = stripLeadingZeros(hexIntRaw);
    const hexDec = decimalFractionToHexDigits(dDec, FLOAT_FORMAT_R_MAX);

    const nonZeroHexDecLen = stripLeadingZeros(hexDec).length;

    // Python の 2**(len(hex_dec.lstrip("0"))-1) に合わせる。
    // len == 0 の場合は 2**(-1) == 0.5。
    const hexDecCost = 2 ** (nonZeroHexDecLen - 1);

    addCandidate(
      sign + "0x" + (hexInt + "." + hexDec).toUpperCase(),
      int2sizeDigits(dInt, 1) + hexDecCost
    );
  } else {
    // --------------------------------------------------------
    // 整数の10進数表記
    // --------------------------------------------------------

    addCandidate(
      sign + d,
      int2sizeDigits(d, 1)
    );

    // --------------------------------------------------------
    // 整数の10進数指数表記
    //
    // Python:
    // sign + d[:i] + ("." + d[i:]).rstrip("0").rstrip(".") + "e" + str(len(d) - i)
    // --------------------------------------------------------

    for (let i = 1; i < d.length; i++) {
      const left = d.slice(0, i);
      const right = d.slice(i);
      const exp = d.length - i;

      const mantissaTail = stripTrailingZerosAndDot("." + right);

      addCandidate(
        sign + left + mantissaTail + "e" + String(exp),
        int2sizeDigits(left, 0) +
          int2sizeDigits(right, 0) +
          int2sizeInt(exp, 1)
      );
    }
  }

  return bestText;
}
