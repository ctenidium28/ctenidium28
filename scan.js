"use strict";

// ------------------------------------------------------------
// Utilities
// ------------------------------------------------------------

const LIMIT = 2 ** 63 - 512;

const positiveShellCache = new Map();

function positiveShell(t) {
  if (positiveShellCache.has(t)) {
    return positiveShellCache.get(t);
  }

  let result;

  if (t < 1) {
    result = [];
  } else {
    const cur = gen_size(t);
    const prev = gen_size(t - 1);

    result = [];
    for (const a of cur) {
      if (a > 0 && !prev.has(a)) {
        result.push(a);
      }
    }
  }

  positiveShellCache.set(t, result);
  return result;
}

function spow(a, b) {
  try {
    return a ** b;
  } catch {
    return 0;
  }
}

function sdiv(a, b) {
  try {
    return a / b;
  } catch {
    return 0;
  }
}

function smul(a, b) {
  try {
    return a * b;
  } catch {
    return 0;
  }
}

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

function isIntegerValue(x) {
  return typeof x === "number" && Number.isFinite(x) && Number.isInteger(x);
}

function all(arr, pred) {
  for (const x of arr) {
    if (!pred(x)) return false;
  }
  return true;
}

function rangeAll(start, end, pred) {
  for (let i = start; i < end; i++) {
    if (!pred(i)) return false;
  }
  return true;
}

function indexOfZero(arr) {
  return arr.indexOf(0);
}

function sleep0() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

class ScanStop extends Error {
  constructor(message) {
    super(String(message));
    this.name = "ScanStop";
    this.messageText = String(message);
  }
}

class ScanCancelled extends Error {
  constructor() {
    super("Scan stopped.");
    this.name = "ScanCancelled";
  }
}

let currentScanState = null;

function checkCancelled(cancelState) {
  if (cancelState && cancelState.cancelled) {
    throw new ScanCancelled();
  }
}

function drop(exp) {
  throw new ScanStop(exp);
}

// ------------------------------------------------------------
// Core scan
// ------------------------------------------------------------

async function runExpressionScan(rawXIn, rawXOut, maxToken, onProgress, cancelState) {
  let xIn = rawXIn.slice();
  let xOut = rawXOut.slice();

  if (xIn.length !== xOut.length) {
    drop("Please make input and color the same length.");
  }

  if (xIn.length === 0) {
    drop("Please enter at least one input pair.");
  }

  if (new Set(xIn).size < xIn.length) {
    drop("input contains duplicate values.");
  }

  if (!xOut.every(x => isIntegerValue(x) && 0 <= x && x <= 16)) {
    drop("color must contain integers from 0 to 16.");
  }

  if (new Set(xOut).size === 1) {
    drop(xOut[0]);
  }

  const pairs = xIn.map((xi, i) => ({ xi, xo: xOut[i] }));
  pairs.sort((a, b) => a.xi - b.xi);

  xIn = pairs.map(p => p.xi);
  xOut = pairs.map(p => p.xo);

  const isInt = xIn.every(x => isIntegerValue(x));

  const sList = [
    xIn,
    xIn.map(x => -x)
  ];

  const sStr = ["", "-"];

  if (isInt) {
    sList.push(
      xIn.map(x => -x - 1),
      xIn.map(x => x + 1),
      xIn.map(x => x - 1)
    );
    sStr.push("~", "-~", "~-");
  }

  let l0 = 0;
  let r0 = xIn.length;

  while (xOut[l0] === 0) {
    l0++;
  }

  while (xOut[r0 - 1] === 0) {
    r0--;
  }

  const xCod = xOut.slice(l0, r0);
  const isDense = !xCod.includes(0);

  if (!isDense) {
    drop("Not Found");
  }

  let workCounter = 0;

  function scan(sx, expr) {
    for (let i = 0; i < sx.length; i++) {
      let ex;

      try {
        ex = expr(sx[i]);
      } catch {
        return false;
      }

      if (disp(ex) !== xOut[i]) {
        return false;
      }
    }

    return true;
  }

  async function maybeYield(token, sym) {
    checkCancelled(cancelState);

    workCounter++;

    if ((workCounter & 4095) === 0) {
      if (onProgress) {
        onProgress(`Scanning... token=${token}, symbol="${sym || "x"}", checks=${workCounter}`);
      }

      await sleep0();
      checkCancelled(cancelState);
    }
  }

  for (let token = 3; token <= maxToken; token++) {
    checkCancelled(cancelState);

    if (onProgress) {
      onProgress(`Scanning... token=${token}`);
    }

    await sleep0();
    checkCancelled(cancelState);

    for (let si = 0; si < sList.length; si++) {
      checkCancelled(cancelState);

      const sym = sStr[si];
      const sx = sList[si];

      const xDom = sx.slice(l0, r0);
      const inc = sx[0] < sx[sx.length - 1];

      let isDomPlus;
      let isDomMinus;

      if (inc) {
        isDomPlus =
          all(xDom, x => x >= 0) &&
          rangeAll(0, l0, i => sx[i] < 0);
      } else {
        isDomPlus =
          all(xDom, x => x >= 0) &&
          rangeAll(r0, sx.length, i => sx[i] < 0);
      }

      if (inc) {
        isDomMinus =
          all(xDom, x => x <= 0) &&
          rangeAll(r0, sx.length, i => sx[i] > 0);
      } else {
        isDomMinus =
          all(xDom, x => x <= 0) &&
          rangeAll(0, l0, i => sx[i] > 0);
      }

      // ------------------------------------------------------
      // a^x
      // ------------------------------------------------------

      let tokenRange = token - sym.length - 2;
      const ziPow = indexOfZero(sx);

      if (tokenRange >= 1 && (ziPow === -1 || xOut[ziPow] === 1)) {
        let A;

        if (isDomPlus && isDomMinus) {
          drop(`0^${sym}x`);
        } else if (isDomPlus) {
          A = positiveShell(tokenRange).filter(a => a >= 1);
        } else if (isDomMinus) {
          A = positiveShell(tokenRange).filter(a => a <= 1);
        } else {
          A = [];
        }

        for (const a of A) {
          if (scan(sx, x => spow(a, x))) {
            drop(`${repFormat(tokenRange, a)}^${sym}x`);
          }

          await maybeYield(token, sym);
        }
      }

      // ------------------------------------------------------
      // a^x/b, b/a^x, a^x*b
      // ------------------------------------------------------

      tokenRange = token - sym.length - 3;

      if (tokenRange >= 2) {
        for (let t = 1; t < tokenRange; t++) {
          const A = positiveShell(t);
          const B = positiveShell(tokenRange - t);

          let B1;
          let B2;

          const zi = indexOfZero(sx);

          if (zi !== -1) {
            const y0 = xOut[zi];

            B1 = B.filter(b => disp(1 / b) === y0);
            B2 = B.filter(b => disp(b) === y0);
          } else {
            B1 = B;
            B2 = B;
          }

          for (const a of A) {
            for (const b of B1) {
              if (scan(sx, x => sdiv(spow(a, x), b))) {
                drop(`${repFormat(t, a)}^${sym}x/${repFormat(tokenRange - t, b)}`);
              }

              await maybeYield(token, sym);
            }

            for (const b of B2) {
              if (scan(sx, x => sdiv(b, spow(a, x)))) {
                drop(`${repFormat(tokenRange - t, b)}/${repFormat(t, a)}^${sym}x`);
              }

              if (scan(sx, x => smul(spow(a, x), b))) {
                drop(`${repFormat(t, a)}^${sym}x*${repFormat(tokenRange - t, b)}`);
              }

              await maybeYield(token, sym);
            }
          }
        }
      }
    }
  }

  drop("Not Found");
}

// ------------------------------------------------------------
// UI
// ------------------------------------------------------------

const pairsBody = document.getElementById("pairsBody");
const addRowButton = document.getElementById("addRowButton");
const runButton = document.getElementById("runButton");
const stopButton = document.getElementById("stopButton");
const maxTokenInput = document.getElementById("maxTokenInput");
const resultOutput = document.getElementById("resultOutput");

function createInput(value) {
  const input = document.createElement("input");
  input.type = "number";
  input.step = "any";
  input.value = String(value);
  return input;
}

function renumberRows() {
  const rows = Array.from(pairsBody.querySelectorAll("tr"));

  rows.forEach((row, index) => {
    row.querySelector(".row-number").textContent = String(index + 1);
  });
}

function addRow(xInValue = 0, xOutValue = 0) {
  const tr = document.createElement("tr");

  const tdIndex = document.createElement("td");
  tdIndex.className = "row-number";

  const tdXIn = document.createElement("td");
  const xInInput = createInput(xInValue);
  xInInput.className = "x-in-input";
  tdXIn.appendChild(xInInput);

  const tdXOut = document.createElement("td");
  const xOutInput = createInput(xOutValue);
  xOutInput.className = "x-out-input";
  xOutInput.min = "0";
  xOutInput.max = "16";
  xOutInput.step = "1";
  tdXOut.appendChild(xOutInput);

  const tdAction = document.createElement("td");
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "danger";
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", () => {
    tr.remove();
    renumberRows();
  });
  tdAction.appendChild(removeButton);

  tr.appendChild(tdIndex);
  tr.appendChild(tdXIn);
  tr.appendChild(tdXOut);
  tr.appendChild(tdAction);

  pairsBody.appendChild(tr);
  renumberRows();
}

function readPairs() {
  const rows = Array.from(pairsBody.querySelectorAll("tr"));

  const xIn = [];
  const xOut = [];

  for (const row of rows) {
    const xiText = row.querySelector(".x-in-input").value;
    const xoText = row.querySelector(".x-out-input").value;

    const xi = Number(xiText);
    const xo = Number(xoText);

    if (!Number.isFinite(xi)) {
      throw new Error("input must contain finite numbers.");
    }

    if (!Number.isFinite(xo)) {
      throw new Error("color must contain finite numbers.");
    }

    xIn.push(xi);
    xOut.push(xo);
  }

  return { xIn, xOut };
}

addRowButton.addEventListener("click", () => {
  addRow(0, 0);
});

runButton.addEventListener("click", async () => {
  resultOutput.textContent = "Scanning...";

  const cancelState = { cancelled: false };
  currentScanState = cancelState;

  runButton.disabled = true;
  stopButton.disabled = false;
  addRowButton.disabled = true;
  maxTokenInput.disabled = true;

  try {
    const { xIn, xOut } = readPairs();
    const maxToken = Number(maxTokenInput.value);

    if (!Number.isInteger(maxToken) || maxToken < 3) {
      throw new Error("Max token must be an integer greater than or equal to 3.");
    }

    await runExpressionScan(xIn, xOut, maxToken, message => {
      resultOutput.textContent = message;
    }, cancelState);

  } catch (e) {
    if (e instanceof ScanCancelled) {
      resultOutput.textContent = "Stopped.";
    } else if (e instanceof ScanStop) {
      resultOutput.textContent = e.messageText;
    } else {
      resultOutput.textContent = String(e && e.stack ? e.stack : e);
    }
  } finally {
    if (currentScanState === cancelState) {
      currentScanState = null;
    }

    runButton.disabled = false;
    stopButton.disabled = true;
    addRowButton.disabled = false;
    maxTokenInput.disabled = false;
  }
});

stopButton.addEventListener("click", () => {
  if (currentScanState) {
    currentScanState.cancelled = true;
    resultOutput.textContent = "Stopping...";
    stopButton.disabled = true;
  }
});

// Default sample:
// x_in  = [0, 1, 2, 3]
// x_out = [1, 7, 13, 1]
addRow(-1, 10);
addRow(0, 9);
addRow(1, 7);
