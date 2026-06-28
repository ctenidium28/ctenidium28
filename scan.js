"use strict";

// ------------------------------------------------------------
// Utilities
// ------------------------------------------------------------

const LIMIT = 2 ** 63 - 512;

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
    if (b === 0) return 0;
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
    if (b === 0) return 0;

    // Python-compatible modulo:
    // Python: a % b == a - floor(a / b) * b
    const y = a - Math.floor(a / b) * b;
    return Number.isNaN(y) ? 0 : y;
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

function drop(exp) {
  throw new ScanStop(exp);
}

let currentScanState = null;

function checkCancelled(cancelState) {
  if (cancelState && cancelState.cancelled) {
    throw new ScanCancelled();
  }
}

// ------------------------------------------------------------
// Core scan
// ------------------------------------------------------------

async function runExpressionScan(rawXIn, rawXOut, maxToken, onProgress, cancelState) {
  let xIn = rawXIn.slice();
  let xOut = rawXOut.slice();

  if (xIn.length !== xOut.length) {
    drop("Please make x_in and x_out the same length.");
  }

  const leng = xIn.length;

  if (leng === 0) {
    drop("Please enter at least one input pair.");
  }

  if (new Set(xIn).size < leng) {
    drop("x_in contains duplicate values.");
  }

  if (!xOut.every(x => isIntegerValue(x) && 0 <= x && x <= 16)) {
    drop("x_out must contain integers from 0 to 16.");
  }

  if (new Set(xOut).size === 1) {
    drop(xOut[0]);
  }

  const maxOut = Math.max(...xOut);

  // Sort x_in ascending together with x_out.
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

  // Effective domain/codomain interval.
  let l0 = 0;
  let r0 = leng;

  while (xOut[l0] === 0) {
    l0++;
  }

  while (xOut[r0 - 1] === 0) {
    r0--;
  }

  const xCod = xOut.slice(l0, r0);
  const isDense = !xCod.includes(0);

  let workCounter = 0;

  async function maybeYield(token, sym) {
    checkCancelled(cancelState);

    workCounter++;

    if ((workCounter & 4095) === 0) {
      if (onProgress) {
        onProgress(
          `Scanning... token=${token}, symbol="${sym || "x"}", checks=${workCounter}`
        );
      }

      await sleep0();
      checkCancelled(cancelState);
    }
  }

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

  function scanDivPowByB(powVals, b) {
    for (let i = 0; i < powVals.length; i++) {
      if (disp(sdiv(powVals[i], b)) !== xOut[i]) {
        return false;
      }
    }

    return true;
  }

  function scanBByPowAndMul(powVals, b) {
    let okDiv = true;
    let okMul = true;

    for (let i = 0; i < powVals.length; i++) {
      const p = powVals[i];
      const y = xOut[i];

      if (okDiv && disp(sdiv(b, p)) !== y) {
        okDiv = false;
      }

      if (okMul && disp(smul(p, b)) !== y) {
        okMul = false;
      }

      if (!okDiv && !okMul) {
        return null;
      }
    }

    if (okDiv) return "div";
    if (okMul) return "mul";
    return null;
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
      const symLen = sym.length;

      const xDom = sx.slice(l0, r0);
      const inc = sx[0] < sx[sx.length - 1];

      const zeroIndex = sx.indexOf(0);

      let isDomPlus;
      let isDomMinus;

      if (inc) {
        isDomPlus =
          all(xDom, x => x >= 0) &&
          rangeAll(0, l0, i => sx[i] < 0);
      } else {
        isDomPlus =
          all(xDom, x => x >= 0) &&
          rangeAll(r0, leng, i => sx[i] < 0);
      }

      if (inc) {
        isDomMinus =
          all(xDom, x => x <= 0) &&
          rangeAll(r0, leng, i => sx[i] > 0);
      } else {
        isDomMinus =
          all(xDom, x => x <= 0) &&
          rangeAll(0, l0, i => sx[i] > 0);
      }

      if (isDense) {
        // ----------------------------------------------------
        // a^x
        // ----------------------------------------------------

        let tokenRange = token - symLen - 2;

        if (
          1 <= tokenRange &&
          tokenRange <= 4 &&
          (zeroIndex === -1 || xOut[zeroIndex] === 1)
        ) {
          let A;

          if (isDomPlus && isDomMinus) {
            drop(`0^${sym}x`);
          } else if (isDomPlus) {
            if (inc) {
              if (r0 < leng) {
                const border = LIMIT ** (1 / sx[r0]);
                A = Array.from(gen_size(tokenRange)).filter(a => a >= border);
              } else {
                const border = LIMIT ** (1 / sx[sx.length - 1]);
                A = Array.from(gen_size(tokenRange)).filter(a => 1 < a && a < border);
              }
            } else {
              if (l0 > 0) {
                const border = LIMIT ** (1 / sx[l0 - 1]);
                A = Array.from(gen_size(tokenRange)).filter(a => a >= border);
              } else {
                const border = LIMIT ** (1 / sx[0]);
                A = Array.from(gen_size(tokenRange)).filter(a => 1 < a && a < border);
              }
            }
          } else if (isDomMinus) {
            if (inc) {
              if (l0 > 0) {
                const border = LIMIT ** (1 / sx[l0 - 1]);
                A = Array.from(gen_size(tokenRange)).filter(a => a <= border);
              } else {
                const border = LIMIT ** (1 / sx[0]);
                A = Array.from(gen_size(tokenRange)).filter(a => border < a && a < 1);
              }
            } else {
              if (r0 < leng) {
                const border = LIMIT ** (1 / sx[r0]);
                A = Array.from(gen_size(tokenRange)).filter(a => a <= border);
              } else {
                const border = LIMIT ** (1 / sx[sx.length - 1]);
                A = Array.from(gen_size(tokenRange)).filter(a => border < a && a < 1);
              }
            }
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

        // ----------------------------------------------------
        // a^x/b, b/a^x, a^x*b
        // ----------------------------------------------------

        tokenRange = token - symLen - 3;

        if (tokenRange >= 2) {
          const li = l0;
          const ri = r0 - 1;
          const yl = xOut[li];
          const yr = xOut[ri];

          for (let t = 1; t < tokenRange; t++) {
            const bt = tokenRange - t;

            if (t > 4 || bt > 4) {
              continue;
            }

            const A = gen_size(t);
            const B = gen_size(bt);

            let B1Base;
            let B2Base;

            if (zeroIndex !== -1) {
              const y0 = xOut[zeroIndex];

              B1Base = Array.from(B).filter(b => disp(1 / b) === y0);
              B2Base = Array.from(B).filter(b => disp(b) === y0);
            } else {
              B1Base = B;
              B2Base = B;
            }

            if (B1Base.length === 0 && B2Base.length === 0) {
              continue;
            }

            const useBByPowAndMul =
              sym === "" || sym === "~" || sym === "~-";

            for (const a of A) {
              const pl = spow(a, sx[li]);
              const pr = spow(a, sx[ri]);

              const canFilterByEndpoint =
                Number.isFinite(pl) &&
                Number.isFinite(pr) &&
                pl > 0 &&
                pr > 0;

              let B1;
              let B2;

              if (canFilterByEndpoint) {
                const pMin = Math.min(pl, pr);
                const pMax = Math.max(pl, pr);

                // a^x / b:
                // p_max / LIMIT < b <= p_min
                const b1Low = pMax / LIMIT;
                const b1High = pMin;

                B1 = Array.from(B1Base).filter(
                  b =>
                    b1Low <= b &&
                    b <= b1High &&
                    disp(sdiv(pl, b)) === yl &&
                    disp(sdiv(pr, b)) === yr
                );

                if (useBByPowAndMul) {
                  // b / a^x:
                  // p_max <= b < LIMIT * p_min
                  const b2DivLow = pMax;
                  const b2DivHigh = LIMIT * pMin;

                  // a^x * b:
                  // 1 / p_min <= b < LIMIT / p_max
                  const b2MulLow = 1 / pMin;
                  const b2MulHigh = LIMIT / pMax;

                  B2 = Array.from(B2Base).filter(
                    b =>
                      (
                        b2DivLow <= b &&
                        b <= b2DivHigh &&
                        disp(sdiv(b, pl)) === yl &&
                        disp(sdiv(b, pr)) === yr
                      ) ||
                      (
                        b2MulLow <= b &&
                        b <= b2MulHigh &&
                        disp(smul(pl, b)) === yl &&
                        disp(smul(pr, b)) === yr
                      )
                  );
                } else {
                  B2 = [];
                }
              } else {
                B1 = B1Base;
                B2 = useBByPowAndMul ? B2Base : [];
              }

              if (B1.length === 0 && B2.length === 0) {
                continue;
              }

              const powVals = sx.map(x => spow(a, x));

              let repA = null;

              for (const b of B1) {
                if (scanDivPowByB(powVals, b)) {
                  if (repA === null) {
                    repA = repFormat(t, a);
                  }

                  drop(
                    `${repA}^${sym}x/` +
                    `${repFormat(bt, b)}`
                  );
                }

                await maybeYield(token, sym);
              }

              for (const b of B2) {
                const result = scanBByPowAndMul(powVals, b);

                if (result !== null) {
                  if (repA === null) {
                    repA = repFormat(t, a);
                  }

                  const repB = repFormat(bt, b);

                  if (result === "div") {
                    drop(`${repB}/${repA}^${sym}x`);
                  }

                  if (result === "mul") {
                    drop(`${repA}^${sym}x*${repB}`);
                  }
                }

                await maybeYield(token, sym);
              }
            }
          }
        }
      } else {
        // ----------------------------------------------------
        // a^x % b
        // ----------------------------------------------------

        let tokenRange = token - symLen - 3;

        if (
          tokenRange >= 2 &&
          (zeroIndex === -1 || xOut[zeroIndex] === 1)
        ) {
          for (let t = 1; t < tokenRange; t++) {
            const bt = tokenRange - t;

            if (t > 4 || bt > 4) {
              continue;
            }

            const A = gen_size(t);
            const B = Array.from(gen_size(bt)).filter(b => b > maxOut);

            for (const a of A) {
              for (const b of B) {
                if (scan(sx, x => smod(spow(a, x), b))) {
                  drop(
                    `${repFormat(t, a)}^${sym}x%` +
                    `${repFormat(bt, b)}`
                  );
                }

                await maybeYield(token, sym);
              }
            }
          }
        }

        // ----------------------------------------------------
        // x/a % b
        // ----------------------------------------------------

        if (
          tokenRange >= 2 &&
          zeroIndex !== -1 &&
          xOut[zeroIndex] === 0
        ) {
          for (let t = 1; t < tokenRange; t++) {
            const bt = tokenRange - t;

            if (t > 4 || bt > 4) {
              continue;
            }

            const A = gen_size(t);
            const B = Array.from(gen_size(bt)).filter(b => b > maxOut);

            for (const a of A) {
              for (const b of B) {
                if (scan(sx, x => smod(sdiv(x, a), b))) {
                  if (sym === "-" || sym === "-~") {
                    drop(
                      `${sym.slice(1)}x/-${repFormat(t, a)}%` +
                      `${repFormat(bt, b)}`
                    );
                  } else {
                    drop(
                      `${sym}x/${repFormat(t, a)}%` +
                      `${repFormat(bt, b)}`
                    );
                  }
                }

                await maybeYield(token, sym);
              }
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
const copyResultButton = document.getElementById("copyResultButton");

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
      throw new Error("x_in must contain finite numbers.");
    }

    if (!Number.isFinite(xo)) {
      throw new Error("x_out must contain finite numbers.");
    }

    xIn.push(xi);
    xOut.push(xo);
  }

  return { xIn, xOut };
}

addRowButton.addEventListener("click", () => {
  addRow(0, 0);
});

if (stopButton) {
  stopButton.addEventListener("click", () => {
    if (currentScanState) {
      currentScanState.cancelled = true;
      resultOutput.textContent = "Stopping...";
      stopButton.disabled = true;
    }
  });
}

runButton.addEventListener("click", async () => {
  resultOutput.textContent = "Scanning...";

  const cancelState = { cancelled: false };
  currentScanState = cancelState;

  runButton.disabled = true;
  addRowButton.disabled = true;
  maxTokenInput.disabled = true;

  if (stopButton) {
    stopButton.disabled = false;
  }

  try {
    const { xIn, xOut } = readPairs();
    const maxToken = Number(maxTokenInput.value);

    if (!Number.isInteger(maxToken) || maxToken < 3) {
      throw new Error("Max token must be an integer greater than or equal to 3.");
    }

    await runExpressionScan(
      xIn,
      xOut,
      maxToken,
      message => {
        resultOutput.textContent = message;
      },
      cancelState
    );
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
    addRowButton.disabled = false;
    maxTokenInput.disabled = false;

    if (stopButton) {
      stopButton.disabled = true;
    }
  }
});

if (copyResultButton) {
  copyResultButton.addEventListener("click", async () => {
    const text = resultOutput.textContent;

    try {
      await navigator.clipboard.writeText(text);
      copyResultButton.textContent = "Copied";

      setTimeout(() => {
        copyResultButton.textContent = "Copy";
      }, 1000);
    } catch {
      copyResultButton.textContent = "Failed";

      setTimeout(() => {
        copyResultButton.textContent = "Copy";
      }, 1000);
    }
  });
}

// Default sample:
addRow(-1, 10);
addRow(0, 9);
addRow(1, 7);
