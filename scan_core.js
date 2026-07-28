"use strict";

// ------------------------------------------------------------
// Constants
// ------------------------------------------------------------
//
// Python:
//   LIMIT = 2**63 - 512
//
// JavaScript の Number では、この値を厳密に表現できない。
// ビット演算結果の判定には LIMIT_BIGINT を使い、
// 通常の浮動小数点演算には LIMIT を使う。
// ------------------------------------------------------------

const LIMIT_BIGINT = (1n << 63n) - 512n;
const LIMIT = Number(LIMIT_BIGINT);


// ------------------------------------------------------------
// Safe arithmetic
// ------------------------------------------------------------

function spow(a, b) {
  try {
    const y = a ** b;
    return Number.isNaN(y) ? 0 : y;
  } catch {
    return 0;
  }
}


function sdiv(a, b) {
  try {
    if (b === 0 || b === 0n) {
      return 0;
    }

    const y = a / b;
    return Number.isNaN(y) ? 0 : y;
  } catch {
    return 0;
  }
}


function smul(a, b) {
  try {
    const y = a * b;
    return Number.isNaN(y) ? 0 : y;
  } catch {
    return 0;
  }
}


function smod(a, b) {
  try {
    if (b === 0 || b === 0n) {
      return 0;
    }

    // BigInt同士なら、JavaScript標準の % は負数について
    // Pythonと異なるため、同じ公式をBigIntで実装する。
    if (typeof a === "bigint" && typeof b === "bigint") {
      let q = a / b;
      const r = a % b;

      // BigInt の / は0方向への切り捨てなので、
      // Pythonの floor除算へ補正する。
      if (r !== 0n && ((r > 0n) !== (b > 0n))) {
        q -= 1n;
      }

      return a - q * b;
    }

    const x = Number(a);
    const y = Number(b);

    if (!Number.isFinite(x) || !Number.isFinite(y) || y === 0) {
      return 0;
    }

    // Python-compatible modulo:
    //   a % b == a - floor(a / b) * b
    const result = x - Math.floor(x / y) * y;

    return Number.isNaN(result) ? 0 : result;
  } catch {
    return 0;
  }
}


// ------------------------------------------------------------
// Integer conversion for bit operations
// ------------------------------------------------------------
//
// JavaScript標準の &, |, ^, <<, >> は、Numberに対して
// 32-bit符号付き整数への切り詰めを行う。
//
// Python版の任意精度整数に近づけるため、
// Web版のビット演算ではBigIntを使用する。
// ------------------------------------------------------------

function toBigIntInteger(value) {
  if (typeof value === "bigint") {
    return value;
  }

  if (
    typeof value === "number" &&
    Number.isSafeInteger(value)
  ) {
    return BigInt(value);
  }

  throw new TypeError(
    "bit operation requires a safe integer"
  );
}


// ------------------------------------------------------------
// Safe shifts
//
// 負のシフト量は反対方向のシフトとして扱う。
// ------------------------------------------------------------

function lshift(a, b) {
  try {
    const x = toBigIntInteger(a);
    const shift = toBigIntInteger(b);

    if (shift >= 0n) {
      return x << shift;
    }

    return x >> (-shift);
  } catch {
    return 0n;
  }
}


function rshift(a, b) {
  try {
    const x = toBigIntInteger(a);
    const shift = toBigIntInteger(b);

    if (shift >= 0n) {
      return x >> shift;
    }

    return x << (-shift);
  } catch {
    return 0n;
  }
}


// ------------------------------------------------------------
// Safe bit operations
//
// Python:
//   operator.and_
//   operator.or_
//   operator.xor
//
// に対応する。
// ------------------------------------------------------------

function bitAnd(a, b) {
  try {
    return (
      toBigIntInteger(a) &
      toBigIntInteger(b)
    );
  } catch {
    return 0n;
  }
}


function bitOr(a, b) {
  try {
    return (
      toBigIntInteger(a) |
      toBigIntInteger(b)
    );
  } catch {
    return 0n;
  }
}


function bitXor(a, b) {
  try {
    return (
      toBigIntInteger(a) ^
      toBigIntInteger(b)
    );
  } catch {
    return 0n;
  }
}


// ------------------------------------------------------------
// Display color
// ------------------------------------------------------------

function disp(x) {
  try {
    // --------------------------------------------------------
    // BigInt
    // --------------------------------------------------------
    if (typeof x === "bigint") {
      if (x < 1n || x >= LIMIT_BIGINT) {
        return 0;
      }

      // この分岐では x > 0 なので、剰余は0..15になる。
      const v = Number(x % 16n);

      return v + ((v - 1) & 16);
    }

    // --------------------------------------------------------
    // Number、およびNumberへ変換可能な値
    // --------------------------------------------------------
    const fx = Number(x);

    if (
      !Number.isFinite(fx) ||
      fx < 1 ||
      fx >= LIMIT
    ) {
      return 0;
    }

    // fx > 0 なので、JavaScriptの % とPythonの % は一致する。
    const v = Math.floor(fx % 16);

    return v + ((v - 1) & 16);
  } catch {
    return 0;
  }
}


// ------------------------------------------------------------
// Temporary scan compatibility
//
// 現行のscan.jsがdrop()を利用している可能性があるため、
// Worker移行が完了するまでは残す。
//
// 最終的にはscan_worker.js側で結果をpostMessageする。
// ------------------------------------------------------------

class ScanStop extends Error {
  constructor(message) {
    super(String(message));

    this.name = "ScanStop";
    this.messageText = String(message);
  }
}


function drop(exp) {
  throw new ScanStop(exp);
}


// ------------------------------------------------------------
// Browser / Web Worker globals
// ------------------------------------------------------------

Object.assign(globalThis, {
  LIMIT,
  LIMIT_BIGINT,

  spow,
  sdiv,
  smul,
  smod,

  lshift,
  rshift,

  bitAnd,
  bitOr,
  bitXor,

  disp,

  ScanStop,
  drop,
});
