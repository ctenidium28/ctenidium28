"use strict";

// ------------------------------------------------------------
// Constants
// ------------------------------------------------------------

const LIMIT_BIGINT = (1n << 63n) - 512n;
const LIMIT = Number(LIMIT_BIGINT);
const INT_BITS = 64;
const INT_MIN = -(1n << 63n);
const INT_MAX = (1n << 63n) - 1n;
const UINT_MOD = 1n << 64n;
const UINT_MASK = UINT_MOD - 1n;


class LuaRuntimeError extends Error {
  constructor(message) {
    super(message);
    this.name = "LuaRuntimeError";
  }
}


// ------------------------------------------------------------
// Integer / float conversion
// ------------------------------------------------------------

function wrapInt(x) {
  return BigInt.asIntN(64, x);
}


function checkInt(x) {
  if (typeof x !== "bigint" || x < INT_MIN || x > INT_MAX) {
    throw new LuaRuntimeError("invalid Lua integer");
  }
  return x;
}


function toFloat(x) {
  if (typeof x === "bigint") {
    return Number(checkInt(x));
  }
  if (typeof x === "number") {
    return x;
  }
  throw new LuaRuntimeError("number expected");
}


function toInteger(x) {
  if (typeof x === "bigint") {
    return checkInt(x);
  }

  if (
    typeof x === "number" &&
    Number.isFinite(x) &&
    Number.isInteger(x) &&
    x >= -(2 ** 63) &&
    x < 2 ** 63
  ) {
    return BigInt(x);
  }

  throw new LuaRuntimeError("number has no integer representation");
}


function normalizeNumber(x) {
  if (typeof x === "bigint") {
    return checkInt(x);
  }
  if (typeof x === "number") {
    return x;
  }
  throw new LuaRuntimeError("number expected");
}


// ------------------------------------------------------------
// Lua numeral
// ------------------------------------------------------------

const SPECIAL_CONSTANTS = [
  ["pi", Math.PI],
  ["maxinteger", INT_MAX],
  ["mininteger", INT_MIN],
  ["huge", Infinity],
];

const SPECIAL_CONSTANT_MAP = new Map(SPECIAL_CONSTANTS);


function bitLengthBigInt(x) {
  return x === 0n ? 0 : x.toString(2).length;
}


function roundShiftRightEven(x, shift) {
  if (shift <= 0) {
    return x << BigInt(-shift);
  }

  const s = BigInt(shift);
  const q = x >> s;
  const mask = (1n << s) - 1n;
  const r = x & mask;
  const half = 1n << (s - 1n);

  if (r > half || (r === half && (q & 1n) !== 0n)) {
    return q + 1n;
  }
  return q;
}


function binaryRationalToNumber(mantissa, exponent2) {
  if (mantissa === 0n) {
    return 0;
  }

  const bits = bitLengthBigInt(mantissa);
  let exponent = bits - 1 + exponent2;

  if (exponent < -1022) {
    const shift = -(exponent2 + 1074);
    const q = roundShiftRightEven(mantissa, shift);

    if (q === 0n) {
      return 0;
    }

    return Number(q) * Number.MIN_VALUE;
  }

  const shift = bits - 53;
  let significand = roundShiftRightEven(mantissa, shift);

  if (significand >= (1n << 53n)) {
    significand >>= 1n;
    exponent += 1;
  }

  if (exponent > 1023) {
    return Infinity;
  }

  return Number(significand) * (2 ** (exponent - 52));
}


function parseHexFloat(text) {
  const lower = text.toLowerCase();
  const pIndex = lower.indexOf("p");
  const mantissaText = pIndex === -1 ? lower.slice(2) : lower.slice(2, pIndex);
  const p = pIndex === -1 ? 0 : Number(lower.slice(pIndex + 1));

  if (!Number.isInteger(p)) {
    return NaN;
  }

  const dotIndex = mantissaText.indexOf(".");
  const intPart = dotIndex === -1 ? mantissaText : mantissaText.slice(0, dotIndex);
  const fracPart = dotIndex === -1 ? "" : mantissaText.slice(dotIndex + 1);
  const digits = (intPart + fracPart) || "0";

  if (!/^[0-9a-f]+$/.test(digits)) {
    return NaN;
  }

  const mantissa = BigInt("0x" + digits);
  const exponent2 = p - 4 * fracPart.length;
  return binaryRationalToNumber(mantissa, exponent2);
}


function luaLiteralValue(text) {
  let s = String(text).trim();

  if (SPECIAL_CONSTANT_MAP.has(s)) {
    return SPECIAL_CONSTANT_MAP.get(s);
  }

  let negative = false;

  if (s.startsWith("+") || s.startsWith("-")) {
    negative = s[0] === "-";
    s = s.slice(1);
  }

  const lower = s.toLowerCase();

  if (lower.startsWith("0x")) {
    if (lower.includes(".") || lower.includes("p")) {
      const value = parseHexFloat(s);
      return negative ? -value : value;
    }

    const value = wrapInt(BigInt(s));
    return negative ? wrapInt(-value) : value;
  }

  if (s.includes(".") || lower.includes("e")) {
    const value = Number(s);
    return negative ? -value : value;
  }

  let value = BigInt(s);

  if (value <= INT_MAX) {
    return negative ? -value : value;
  }

  const floatValue = Number(s);
  return negative ? -floatValue : floatValue;
}


// ------------------------------------------------------------
// Internal float operations
// ------------------------------------------------------------

function floatDiv(a, b) {
  return a / b;
}


function floatFloorDiv(a, b) {
  const q = floatDiv(a, b);

  if (!Number.isFinite(q) || q === 0) {
    return q;
  }

  return Math.floor(q);
}


function floatMod(a, b) {
  let r = a % b;

  if ((r > 0 && b < 0) || (r < 0 && b > 0)) {
    r += b;
  }

  return r;
}


function floatPow(a, b) {
  if (b === 2) {
    return a * a;
  }
  return Math.pow(a, b);
}


// ------------------------------------------------------------
// Arithmetic operators
// ------------------------------------------------------------

function sadd(a, b) {
  if (typeof a === "bigint" && typeof b === "bigint") {
    return wrapInt(checkInt(a) + checkInt(b));
  }
  return toFloat(a) + toFloat(b);
}


function ssub(a, b) {
  if (typeof a === "bigint" && typeof b === "bigint") {
    return wrapInt(checkInt(a) - checkInt(b));
  }
  return toFloat(a) - toFloat(b);
}


function smul(a, b) {
  if (typeof a === "bigint" && typeof b === "bigint") {
    return wrapInt(checkInt(a) * checkInt(b));
  }
  return toFloat(a) * toFloat(b);
}


function sdiv(a, b) {
  return floatDiv(toFloat(a), toFloat(b));
}


function sfloordiv(a, b) {
  if (typeof a === "bigint" && typeof b === "bigint") {
    a = checkInt(a);
    b = checkInt(b);

    if (b === 0n) {
      throw new LuaRuntimeError("attempt to divide by zero");
    }

    if (b === -1n) {
      return wrapInt(-a);
    }

    let q = a / b;
    const r = a % b;

    if (r !== 0n && ((r < 0n) !== (b < 0n))) {
      q -= 1n;
    }

    return q;
  }

  return floatFloorDiv(toFloat(a), toFloat(b));
}


function smod(a, b) {
  if (typeof a === "bigint" && typeof b === "bigint") {
    a = checkInt(a);
    b = checkInt(b);

    if (b === 0n) {
      throw new LuaRuntimeError("attempt to perform 'n%0'");
    }

    if (b === -1n) {
      return 0n;
    }

    let r = a % b;
    if (r !== 0n && ((r < 0n) !== (b < 0n))) {
      r += b;
    }
    return r;
  }

  return floatMod(toFloat(a), toFloat(b));
}


function spow(a, b) {
  return floatPow(toFloat(a), toFloat(b));
}


function sneg(a) {
  if (typeof a === "bigint") {
    return wrapInt(-checkInt(a));
  }
  return -toFloat(a);
}


// ------------------------------------------------------------
// Bitwise operators
// ------------------------------------------------------------

function band(a, b) {
  return wrapInt(toInteger(a) & toInteger(b));
}


function bor(a, b) {
  return wrapInt(toInteger(a) | toInteger(b));
}


function bxor(a, b) {
  return wrapInt(toInteger(a) ^ toInteger(b));
}


function bnot(a) {
  return wrapInt(~toInteger(a));
}


// Temporary aliases for the current scan_worker.js during migration.
const bitAnd = band;
const bitOr = bor;
const bitXor = bxor;


function lshift(a, b) {
  const x = toInteger(a);
  const y = toInteger(b);

  if (y < 0n) {
    if (y <= -BigInt(INT_BITS)) {
      return 0n;
    }
    return wrapInt(BigInt.asUintN(64, x) >> -y);
  }

  if (y >= BigInt(INT_BITS)) {
    return 0n;
  }

  return wrapInt(BigInt.asUintN(64, x) << y);
}


function rshift(a, b) {
  const x = toInteger(a);
  const y = toInteger(b);

  if (y < 0n) {
    if (y <= -BigInt(INT_BITS)) {
      return 0n;
    }
    return wrapInt(BigInt.asUintN(64, x) << -y);
  }

  if (y >= BigInt(INT_BITS)) {
    return 0n;
  }

  return wrapInt(BigInt.asUintN(64, x) >> y);
}


// ------------------------------------------------------------
// Math functions
// ------------------------------------------------------------

function luaSin(x) {
  return Math.sin(toFloat(x));
}


function luaCos(x) {
  return Math.cos(toFloat(x));
}


function luaTan(x) {
  return Math.tan(toFloat(x));
}


function luaAsin(x) {
  return Math.asin(toFloat(x));
}


function luaAcos(x) {
  return Math.acos(toFloat(x));
}


function luaAtan(y, x = 1.0) {
  return Math.atan2(toFloat(y), toFloat(x));
}


function luaSqrt(x) {
  return Math.sqrt(toFloat(x));
}


function naturalLog(x) {
  return Math.log(x);
}


function log2(x) {
  return Math.log2(x);
}


function log10(x) {
  return Math.log10(x);
}


function luaLog(x, base = null) {
  x = toFloat(x);

  if (base === null || base === undefined) {
    return naturalLog(x);
  }

  base = toFloat(base);

  if (base === 2.0) {
    return log2(x);
  }

  if (base === 10.0) {
    return log10(x);
  }

  return floatDiv(naturalLog(x), naturalLog(base));
}


function luaExp(x) {
  return Math.exp(toFloat(x));
}


function luaFloor(x) {
  if (typeof x === "bigint") {
    return checkInt(x);
  }

  x = toFloat(x);

  if (!Number.isFinite(x)) {
    return x;
  }

  const y = Math.floor(x);

  try {
    return toInteger(y);
  } catch (error) {
    if (!(error instanceof LuaRuntimeError)) {
      throw error;
    }
    return y;
  }
}


function luaCeil(x) {
  if (typeof x === "bigint") {
    return checkInt(x);
  }

  x = toFloat(x);

  if (!Number.isFinite(x)) {
    return x;
  }

  const y = Math.ceil(x);

  try {
    return toInteger(y);
  } catch (error) {
    if (!(error instanceof LuaRuntimeError)) {
      throw error;
    }
    return y;
  }
}


function luaRound(x) {
  return luaFloor(sadd(x, 0.5));
}


function luaTointeger(x) {
  try {
    return toInteger(x);
  } catch (error) {
    if (error instanceof LuaRuntimeError) {
      return null;
    }
    throw error;
  }
}


function luaUlt(a, b) {
  a = BigInt.asUintN(64, toInteger(a));
  b = BigInt.asUintN(64, toInteger(b));
  return a < b;
}


function luaInrange(v, a, b) {
  v = normalizeNumber(v);
  a = normalizeNumber(a);
  b = normalizeNumber(b);
  return a <= v && v <= b;
}


function luaAbs(x) {
  if (typeof x === "bigint") {
    x = checkInt(x);
    return wrapInt(x < 0n ? -x : x);
  }
  return Math.abs(toFloat(x));
}


function luaSign(x) {
  x = normalizeNumber(x);

  if (x < 0) {
    return -1n;
  }
  if (x > 0) {
    return 1n;
  }
  return 0n;
}


function luaFmod(a, b) {
  if (typeof a === "bigint" && typeof b === "bigint") {
    a = checkInt(a);
    b = checkInt(b);

    if (b === 0n) {
      throw new LuaRuntimeError("bad argument #2 to 'fmod' (zero)");
    }

    if (b === -1n) {
      return 0n;
    }

    return a % b;
  }

  a = toFloat(a);
  b = toFloat(b);
  return a % b;
}


function luaMin(...args) {
  if (args.length === 0) {
    throw new LuaRuntimeError("value expected");
  }

  let result = normalizeNumber(args[0]);

  for (let i = 1; i < args.length; i++) {
    const x = normalizeNumber(args[i]);
    if (x < result) {
      result = x;
    }
  }

  return result;
}


function luaMax(...args) {
  if (args.length === 0) {
    throw new LuaRuntimeError("value expected");
  }

  let result = normalizeNumber(args[0]);

  for (let i = 1; i < args.length; i++) {
    const x = normalizeNumber(args[i]);
    if (x > result) {
      result = x;
    }
  }

  return result;
}


function luaClamp(v, a, b) {
  return luaMin(luaMax(v, a), b);
}


function luaMix(a, b, t) {
  return sadd(a, smul(ssub(b, a), t));
}


function luaBtoi(x) {
  return x === false || x === null ? 0n : 1n;
}


function luaDeg(x) {
  return toFloat(x) * (180 / Math.PI);
}


function luaRad(x) {
  return toFloat(x) * (Math.PI / 180);
}


// ------------------------------------------------------------
// Display color
// ------------------------------------------------------------

function disp(x) {
  try {
    x = Number(x);
    if (!(1 <= x && x < 2 ** 63)) {
      return 0;
    }
    const v = Math.floor(x % 16);
    return v === 0 ? 16 : v;
  } catch {
    return 0;
  }
}


const FUNC_LIST = [
  ["sin", luaSin],
  ["cos", luaCos],
  ["tan", luaTan],
  ["asin", luaAsin],
  ["acos", luaAcos],
  ["atan", luaAtan],
  ["sqrt", luaSqrt],
  ["log", luaLog],
  ["deg", luaDeg],
  ["rad", luaRad],
  ["exp", luaExp],
  ["floor", luaFloor],
  ["ceil", luaCeil],
  ["round", luaRound],
  ["abs", luaAbs],
  ["sign", luaSign],
];

const BI_FUNC_LIST = [
  ["atan", luaAtan],
  ["log", luaLog],
  ["fmod", luaFmod],
  ["max", luaMax],
  ["min", luaMin],
];

const TRI_FUNC_LIST = [
  ["clamp", luaClamp],
  ["mix", luaMix],
];

const TERMINAL_FUNC_LIST = [
  ["tointeger", luaTointeger],
];

const UN_OPS = [
  ["-", "u-", sneg],
  ["~", "u~", bnot],
];

const BI_OPS = [
  ["+", sadd],
  ["*", smul],
  ["/", sdiv],
  ["//", sfloordiv],
  ["%", smod],
  ["^", spow],
  ["<<", lshift],
  [">>", rshift],
  ["&", band],
  ["~", bxor],
  ["|", bor],
];


// ------------------------------------------------------------
// Parentheses
// ------------------------------------------------------------

function needParenLeft(outer, symOp) {
  const child = getOp(outer);
  if (child === 0) {
    return false;
  }

  const parent = getOp(symOp);
  if (child < parent) {
    return false;
  }
  if (child > parent) {
    return true;
  }

  return RIGHT_ASSOCIATIVE_OPS.has(symOp);
}


function needParenRight(outer, symOp) {
  const child = getOp(outer);
  if (child === 0) {
    return false;
  }

  const parent = getOp(symOp);
  if (child < parent) {
    return false;
  }
  if (child > parent) {
    return true;
  }

  if (RIGHT_ASSOCIATIVE_OPS.has(symOp)) {
    return outer !== symOp;
  }
  if (ASSOCIATIVE_OPS.has(symOp) && outer === symOp) {
    return false;
  }
  return true;
}


// ------------------------------------------------------------
// Operator precedence
// ------------------------------------------------------------

const OP_PRIORITY = {
  "": 0,
  "u-": 1,
  "u~": 1,
  "^": 2,
  "*": 3,
  "/": 3,
  "//": 3,
  "%": 3,
  "+": 4,
  "-": 4,
  "<<": 5,
  ">>": 5,
  "&": 6,
  "~": 7,
  "|": 8,
};

const COMMUTATIVE_OPS = new Set(["+", "*", "&", "~", "|"]);
const ASSOCIATIVE_OPS = new Set(["+", "*", "&", "~", "|"]);
const RIGHT_ASSOCIATIVE_OPS = new Set(["^"]);


function getOp(outer) {
  return OP_PRIORITY[outer];
}


function isAssociative(symOp, value, a) {
  if (symOp === "&" || symOp === "~" || symOp === "|") {
    return true;
  }

  if (symOp === "+" || symOp === "*") {
    return typeof a === "bigint" && value.every(x => typeof x === "bigint");
  }

  return false;
}


// ------------------------------------------------------------
// Browser / Web Worker globals
// ------------------------------------------------------------

Object.assign(globalThis, {
  LIMIT,
  LIMIT_BIGINT,
  INT_BITS,
  INT_MIN,
  INT_MAX,
  UINT_MOD,
  UINT_MASK,
  LuaRuntimeError,
  SPECIAL_CONSTANTS,
  SPECIAL_CONSTANT_MAP,
  toFloat,
  toInteger,
  normalizeNumber,
  luaLiteralValue,
  sadd,
  ssub,
  smul,
  sdiv,
  sfloordiv,
  smod,
  spow,
  sneg,
  band,
  bor,
  bxor,
  bnot,
  bitAnd,
  bitOr,
  bitXor,
  lshift,
  rshift,
  luaSin,
  luaCos,
  luaTan,
  luaAsin,
  luaAcos,
  luaAtan,
  luaSqrt,
  luaLog,
  luaExp,
  luaFloor,
  luaCeil,
  luaRound,
  luaTointeger,
  luaUlt,
  luaInrange,
  luaAbs,
  luaSign,
  luaFmod,
  luaMin,
  luaMax,
  luaClamp,
  luaMix,
  luaBtoi,
  luaDeg,
  luaRad,
  disp,
  FUNC_LIST,
  BI_FUNC_LIST,
  TRI_FUNC_LIST,
  TERMINAL_FUNC_LIST,
  UN_OPS,
  BI_OPS,
  needParenLeft,
  needParenRight,
  OP_PRIORITY,
  COMMUTATIVE_OPS,
  ASSOCIATIVE_OPS,
  RIGHT_ASSOCIATIVE_OPS,
  getOp,
  isAssociative,
});

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    LIMIT,
    LIMIT_BIGINT,
    INT_BITS,
    INT_MIN,
    INT_MAX,
    UINT_MOD,
    UINT_MASK,
    LuaRuntimeError,
    SPECIAL_CONSTANTS,
    SPECIAL_CONSTANT_MAP,
    toFloat,
    toInteger,
    normalizeNumber,
    luaLiteralValue,
    sadd,
    ssub,
    smul,
    sdiv,
    sfloordiv,
    smod,
    spow,
    sneg,
    band,
    bor,
    bxor,
    bnot,
    bitAnd,
    bitOr,
    bitXor,
    lshift,
    rshift,
    luaSin,
    luaCos,
    luaTan,
    luaAsin,
    luaAcos,
    luaAtan,
    luaSqrt,
    luaLog,
    luaExp,
    luaFloor,
    luaCeil,
    luaRound,
    luaTointeger,
    luaUlt,
    luaInrange,
    luaAbs,
    luaSign,
    luaFmod,
    luaMin,
    luaMax,
    luaClamp,
    luaMix,
    luaBtoi,
    luaDeg,
    luaRad,
    disp,
    FUNC_LIST,
    BI_FUNC_LIST,
    TRI_FUNC_LIST,
    TERMINAL_FUNC_LIST,
    UN_OPS,
    BI_OPS,
    needParenLeft,
    needParenRight,
    OP_PRIORITY,
    COMMUTATIVE_OPS,
    ASSOCIATIVE_OPS,
    RIGHT_ASSOCIATIVE_OPS,
    getOp,
    isAssociative,
  };
}
