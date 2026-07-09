"use strict";

// ------------------------------------------------------------
// Constants
// ------------------------------------------------------------

const LIMIT = 2 ** 63 - 512;


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
    if (b === 0) {
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
    if (b === 0) {
      return 0;
    }

    // Python-compatible modulo:
    // Python: a % b == a - floor(a / b) * b
    const y = a - Math.floor(a / b) * b;

    return Number.isNaN(y) ? 0 : y;
  } catch {
    return 0;
  }
}


// ------------------------------------------------------------
// Display color
// ------------------------------------------------------------

function disp(x) {
  try {
    const fx = Number(x);

    if (!Number.isFinite(fx)) {
      return 0;
    }

    const v = Math.floor(fx % 16);

    if (1 <= fx && fx < LIMIT) {
      return v + ((v - 1) & 16);
    }

    return 0;
  } catch {
    return 0;
  }
}


// ------------------------------------------------------------
// Drop / stop scan
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
// Browser globals
// ------------------------------------------------------------

if (typeof window !== "undefined") {
  window.LIMIT = LIMIT;
  window.spow = spow;
  window.sdiv = sdiv;
  window.smul = smul;
  window.smod = smod;
  window.disp = disp;
  window.ScanStop = ScanStop;
  window.drop = drop;
}
