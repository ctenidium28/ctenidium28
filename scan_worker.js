"use strict";

// ------------------------------------------------------------
// Dependencies
// ------------------------------------------------------------

importScripts(
  "./scan_core.js",
  "./gen_size.js",
  "./float_format.js",
);

const formatConstant =
  typeof globalThis.repFormat === "function"
    ? globalThis.repFormat
    : typeof globalThis.rep_format === "function"
      ? globalThis.rep_format
      : typeof repFormat === "function"
        ? repFormat
        : null;

if (formatConstant === null) {
  throw new Error(
    "float_format.js must expose repFormat(tokenSize, value).",
  );
}

// ------------------------------------------------------------
// Worker protocol
// ------------------------------------------------------------

class ScanFinished extends Error {
  constructor() {
    super("Scan finished.");
    this.name = "ScanFinished";
  }
}

function finish(expression) {
  postMessage({
    type: "result",
    expression: String(expression),
  });

  throw new ScanFinished();
}

function finishNotFound() {
  postMessage({ type: "not-found" });
  throw new ScanFinished();
}

let workCounter = 0;

function reportProgress(token, sym = null, force = false) {
  if (!force) {
    workCounter++;

    if ((workCounter & 8191) !== 0) {
      return;
    }
  }

  postMessage({
    type: "progress",
    token,
    symbol: sym,
    checks: workCounter,
  });
}

// ------------------------------------------------------------
// Small utilities
// ------------------------------------------------------------

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isIntegerValue(value) {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function isSafeIntegerValue(value) {
  return isFiniteNumber(value) && Number.isSafeInteger(value);
}

function all(values, predicate) {
  for (const value of values) {
    if (!predicate(value)) {
      return false;
    }
  }

  return true;
}

function arrayMax(values) {
  let result = -Infinity;

  for (const value of values) {
    if (value > result) {
      result = value;
    }
  }

  return result;
}

function arrayMin(values) {
  let result = Infinity;

  for (const value of values) {
    if (value < result) {
      result = value;
    }
  }

  return result;
}

function transformedOutputMap(sx, xOut) {
  const map = new Map();

  for (let i = 0; i < sx.length; i++) {
    map.set(sx[i], xOut[i]);
  }

  return map;
}

const FUNC_LIST = [
  ["sin", Math.sin],
  ["cos", Math.cos],
  ["tan", Math.tan],
];

const BIT_LIST = [
  ["&", bitAnd],
  ["|", bitOr],
  ["~", bitXor],
];

// ------------------------------------------------------------
// Core scan
// ------------------------------------------------------------

function runExpressionScan(rawXIn, rawXOut, maxToken, quick) {
  let xIn = rawXIn.slice();
  let xOut = rawXOut.slice();

  if (xIn.length !== xOut.length) {
    throw new Error("Please make x_in and x_out the same length.");
  }

  const leng = xIn.length;

  if (leng === 0) {
    throw new Error("Please enter at least one input pair.");
  }

  if (!xIn.every(isFiniteNumber)) {
    throw new Error("x_in must contain finite numbers.");
  }

  if (new Set(xIn).size < leng) {
    throw new Error("x_in contains duplicate values.");
  }

  if (!xOut.every(x => isIntegerValue(x) && 0 <= x && x <= 16)) {
    throw new Error("x_out must contain integers from 0 to 16.");
  }

  if (new Set(xOut).size === 1) {
    finish(xOut[0]);
  }

  const maxOut = arrayMax(xOut);

  let zeroCount = 0;
  for (const value of xOut) {
    if (value === 0) {
      zeroCount++;
    }
  }
  const zeroRatio = zeroCount / leng;

  // Sort x_in ascending together with x_out.
  const pairs = xIn.map((xi, i) => [xi, xOut[i]]);
  pairs.sort((a, b) => a[0] - b[0]);

  xIn = pairs.map(pair => pair[0]);
  xOut = pairs.map(pair => pair[1]);

  const coloredIdx = [];
  for (let i = 0; i < leng; i++) {
    if (xOut[i] > 0) {
      coloredIdx.push(i);
    }
  }

  // Web版のビット演算はBigIntへ変換するため、safe integerだけを許可する。
  const isInt = xIn.every(isSafeIntegerValue);

  const sList = [
    xIn,
    xIn.map(x => -x),
  ];

  const sStr = ["", "-"];

  if (isInt) {
    sList.push(
      xIn.map(x => -x - 1),
      xIn.map(x => x + 1),
      xIn.map(x => x - 1),
    );

    sStr.push("~", "-~", "~-");
  }

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

  workCounter = 0;

  for (let token = 3; token <= maxToken; token++) {
    reportProgress(token, null, true);

    for (let si = 0; si < sList.length; si++) {
      const sym = sStr[si];
      const sx = sList[si];
      const symLen = sym.length;

      const xDom = sx.slice(l0, r0);
      const zeroIndex = sx.indexOf(0);
      const oneIndex = sx.indexOf(1);
      const minusOneIndex = sx.indexOf(-1);
      const unitIndex = oneIndex !== -1 ? oneIndex : minusOneIndex;

      const sxToOut = transformedOutputMap(sx, xOut);
      let isEvenCompatible = true;

      for (let i = 0; i < sx.length; i++) {
        const opposite = -sx[i];

        if (
          sxToOut.has(opposite) &&
          sxToOut.get(opposite) !== xOut[i]
        ) {
          isEvenCompatible = false;
          break;
        }
      }

      const inc = sx[0] < sx[sx.length - 1];

      let belowDom;
      let aboveDom;

      if (inc) {
        belowDom = sx.slice(0, l0);
        aboveDom = sx.slice(r0);
      } else {
        belowDom = sx.slice(r0);
        aboveDom = sx.slice(0, l0);
      }

      const domPositive = all(xDom, x => x > 0);
      const domNonnegative = all(xDom, x => x >= 0);
      const domNonpositive = all(xDom, x => x <= 0);

      const belowNegative = all(belowDom, x => x < 0);
      const belowNonpositive = all(belowDom, x => x <= 0);

      const abovePositive = all(aboveDom, x => x > 0);
      const aboveNonnegative = all(aboveDom, x => x >= 0);

      // ------------------------------------------------------
      // 0^x
      // ------------------------------------------------------

      let zeroPowOk = true;

      for (let i = 0; i < sx.length; i++) {
        const expected = sx[i] === 0 ? 1 : 0;

        if (xOut[i] !== expected) {
          zeroPowOk = false;
          break;
        }
      }

      const zeroPowToken = symLen + 3;

      if (token === zeroPowToken && zeroPowOk) {
        finish(`0^${sym}x`);
      }

      // ------------------------------------------------------
      // a^x
      // ------------------------------------------------------

      let tokenRange = token - symLen - 2;

      if (
        isDense &&
        1 <= tokenRange &&
        tokenRange <= 4 &&
        (zeroIndex === -1 || xOut[zeroIndex] === 1)
      ) {
        let A;

        if (domNonnegative && belowNegative) {
          if (inc) {
            if (r0 < leng) {
              const border = LIMIT ** (1 / sx[r0]);
              A = gen_size(tokenRange).filter(a => a >= border);
            } else {
              const border = LIMIT ** (1 / sx[sx.length - 1]);
              A = gen_size(tokenRange).filter(
                a => 1 < a && a < border,
              );
            }
          } else if (l0 > 0) {
            const border = LIMIT ** (1 / sx[l0 - 1]);
            A = gen_size(tokenRange).filter(a => a >= border);
          } else {
            const border = LIMIT ** (1 / sx[0]);
            A = gen_size(tokenRange).filter(
              a => 1 < a && a < border,
            );
          }
        } else if (domNonpositive && abovePositive) {
          if (inc) {
            if (l0 > 0) {
              const border = LIMIT ** (1 / sx[l0 - 1]);
              A = gen_size(tokenRange).filter(a => a <= border);
            } else {
              const border = LIMIT ** (1 / sx[0]);
              A = gen_size(tokenRange).filter(
                a => border < a && a < 1,
              );
            }
          } else if (r0 < leng) {
            const border = LIMIT ** (1 / sx[r0]);
            A = gen_size(tokenRange).filter(a => a <= border);
          } else {
            const border = LIMIT ** (1 / sx[sx.length - 1]);
            A = gen_size(tokenRange).filter(
              a => border < a && a < 1,
            );
          }
        } else {
          A = [];
        }

        for (const a of A) {
          let good = true;

          for (let i = 0; i < sx.length; i++) {
            if (disp(spow(a, sx[i])) !== xOut[i]) {
              good = false;
              break;
            }
          }

          if (good) {
            finish(`${formatConstant(tokenRange, a)}^${sym}x`);
          }

          reportProgress(token, sym);
        }
      }

      // ------------------------------------------------------
      // x/a
      // ------------------------------------------------------

      tokenRange = token - symLen - 2;

      let ok =
        isDense &&
        1 <= tokenRange &&
        tokenRange <= 4 &&
        (
          (domNonnegative && belowNonpositive) ||
          (domNonpositive && aboveNonnegative)
        ) &&
        (sym === "" || sym === "~" || sym === "~-");

      if (quick) {
        ok =
          ok &&
          zeroIndex !== -1 &&
          xOut[zeroIndex] === 0;
      } else {
        ok =
          ok &&
          (zeroIndex === -1 || xOut[zeroIndex] === 0);
      }

      if (ok) {
        let A;

        if (domNonnegative && domNonpositive) {
          finish(0);
        } else if (domNonnegative && belowNonpositive) {
          const maximum = arrayMax(xDom);
          A = gen_size(tokenRange).filter(
            a => maximum / LIMIT < a && a < 1,
          );
        } else {
          const minimum = arrayMin(xDom);
          A = gen_size(tokenRange)
            .filter(a => -minimum / LIMIT < a && a < 1)
            .map(a => -a);
        }

        for (const a of A) {
          let good = true;

          for (let i = 0; i < sx.length; i++) {
            if (disp(sdiv(sx[i], a)) !== xOut[i]) {
              good = false;
              break;
            }
          }

          if (good) {
            finish(`${sym}x/${formatConstant(tokenRange, a)}`);
          }

          reportProgress(token, sym);
        }
      }

      // ------------------------------------------------------
      // x^a
      // ------------------------------------------------------

      const parenToken = sym === "" ? 0 : 1;
      tokenRange = token - symLen - parenToken - 2;

      let positivePowerOk =
        1 <= tokenRange &&
        tokenRange <= 4 &&
        isDense &&
        domPositive &&
        belowNonpositive;

      let evenPowerOk =
        1 <= tokenRange &&
        tokenRange <= 4 &&
        isEvenCompatible &&
        sym !== "-" &&
        sym !== "-~";

      if (quick) {
        positivePowerOk =
          positivePowerOk &&
          zeroIndex !== -1 &&
          xOut[zeroIndex] === 0 &&
          oneIndex !== -1 &&
          xOut[oneIndex] === 1;

        evenPowerOk =
          evenPowerOk &&
          zeroIndex !== -1 &&
          xOut[zeroIndex] === 0 &&
          unitIndex !== -1 &&
          xOut[unitIndex] === 1;
      } else {
        positivePowerOk =
          positivePowerOk &&
          (zeroIndex === -1 || xOut[zeroIndex] === 0) &&
          (oneIndex === -1 || xOut[oneIndex] === 1);

        evenPowerOk =
          evenPowerOk &&
          (zeroIndex === -1 || xOut[zeroIndex] === 0) &&
          (unitIndex === -1 || xOut[unitIndex] === 1);
      }

      if (positivePowerOk || evenPowerOk) {
        const G = gen_size(tokenRange);
        const A = [];
        const seenA = new Set();

        if (positivePowerOk) {
          let impossible = false;
          let aLow = 0;
          let aHigh = Infinity;

          for (let i = 0; i < xDom.length; i++) {
            const x = xDom[i];
            const y = xCod[i];

            if (0 < x && x < 1) {
              impossible = true;
              break;
            }

            if (x === 1) {
              if (y !== 1) {
                impossible = true;
                break;
              }

              continue;
            }

            const logX = Math.log(x);
            aLow = Math.max(aLow, Math.log(y) / logX);
            aHigh = Math.min(aHigh, Math.log(LIMIT) / logX);
          }

          if (!impossible && aLow < aHigh) {
            for (const a of G) {
              if (
                a > 0 &&
                aLow <= a &&
                a < aHigh &&
                !seenA.has(a)
              ) {
                seenA.add(a);
                A.push(a);
              }
            }
          }
        }

        if (evenPowerOk) {
          let impossible = false;
          let aLow = 0;
          let aHigh = Infinity;

          for (const i of coloredIdx) {
            const x = Math.abs(sx[i]);
            const y = xOut[i];

            if (x === 0 || (0 < x && x < 1)) {
              impossible = true;
              break;
            }

            if (x === 1) {
              if (y !== 1) {
                impossible = true;
                break;
              }

              continue;
            }

            const logX = Math.log(x);
            aLow = Math.max(aLow, Math.log(y) / logX);
            aHigh = Math.min(aHigh, Math.log(LIMIT) / logX);
          }

          if (!impossible && aLow < aHigh) {
            for (const a of G) {
              const isEvenInteger =
                a > 0 &&
                Number.isInteger(a) &&
                a % 2 === 0;

              if (
                isEvenInteger &&
                aLow <= a &&
                a < aHigh &&
                !seenA.has(a)
              ) {
                seenA.add(a);
                A.push(a);
              }
            }
          }
        }

        for (const a of A) {
          let good = true;

          for (let i = 0; i < sx.length; i++) {
            if (disp(spow(sx[i], a)) !== xOut[i]) {
              good = false;
              break;
            }
          }

          if (good) {
            const repA = formatConstant(tokenRange, a);

            if (sym === "") {
              finish(`x^${repA}`);
            } else {
              finish(`(${sym}x)^${repA}`);
            }
          }

          reportProgress(token, sym);
        }
      }

      // ------------------------------------------------------
      // x&a, x|a, x~a
      // ------------------------------------------------------

      tokenRange = token - symLen - 2;

      if (
        1 <= tokenRange &&
        tokenRange <= 4 &&
        isInt
      ) {
        for (const [symOp, op] of BIT_LIST) {
          for (const a of gen_int(tokenRange)) {
            let good = true;

            for (let i = 0; i < sx.length; i++) {
              if (disp(op(sx[i], a)) !== xOut[i]) {
                good = false;
                break;
              }
            }

            if (good) {
              finish(`${sym}x${symOp}${a}`);
            }

            reportProgress(token, sym);
          }
        }
      }

      // ------------------------------------------------------
      // a^x/b, b/a^x, a^x*b
      // ------------------------------------------------------

      tokenRange = token - symLen - 3;

      if (isDense && tokenRange >= 2) {
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
            B1Base = B.filter(b => disp(sdiv(1, b)) === y0);
            B2Base = B.filter(b => disp(b) === y0);
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
              typeof pl === "number" &&
              typeof pr === "number" &&
              Number.isFinite(pl) &&
              Number.isFinite(pr) &&
              pl > 0 &&
              pr > 0;

            let B1;
            let B2;

            if (canFilterByEndpoint) {
              const pMin = Math.min(pl, pr);
              const pMax = Math.max(pl, pr);

              const b1Low = pMax / LIMIT;
              const b1High = pMin;

              B1 = B1Base.filter(
                b =>
                  b1Low <= b &&
                  b <= b1High &&
                  disp(sdiv(pl, b)) === yl &&
                  disp(sdiv(pr, b)) === yr,
              );

              if (useBByPowAndMul) {
                const b2DivLow = pMax;
                const b2DivHigh = LIMIT * pMin;

                const b2MulLow = 1 / pMin;
                const b2MulHigh = LIMIT / pMax;

                B2 = B2Base.filter(
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
                    ),
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
              let good = true;

              for (let i = 0; i < powVals.length; i++) {
                if (disp(sdiv(powVals[i], b)) !== xOut[i]) {
                  good = false;
                  break;
                }
              }

              if (good) {
                if (repA === null) {
                  repA = formatConstant(t, a);
                }

                finish(`${repA}^${sym}x/${formatConstant(bt, b)}`);
              }

              reportProgress(token, sym);
            }

            for (const b of B2) {
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
                  break;
                }
              }

              let result = null;

              if (okDiv) {
                result = "div";
              } else if (okMul) {
                result = "mul";
              }

              if (result !== null) {
                if (repA === null) {
                  repA = formatConstant(t, a);
                }

                const repB = formatConstant(bt, b);

                if (result === "div") {
                  finish(`${repB}/${repA}^${sym}x`);
                } else {
                  finish(`${repA}^${sym}x*${repB}`);
                }
              }

              reportProgress(token, sym);
            }
          }
        }
      }

      // ------------------------------------------------------
      // (-a)^x/b, b/(-a)^x, (-a)^x*b
      // ------------------------------------------------------
      //
      // 負の底は、指数 sx が全点で整数の場合だけ扱う。
      // colored 点の指数はすべて同じ偶奇でなければならない。
      //
      // 括弧を1 tokenとして追加で数える:
      //   (-a)^x*b
      // ------------------------------------------------------

      tokenRange = token - symLen - 4;

      let negativePowerOk = false;
      let coloredParity = null;
      let sxParity = null;

      if (isInt && tokenRange >= 2) {
        sxParity = sx.map(x => Math.abs(x % 2));
        coloredParity = sxParity[coloredIdx[0]];

        let sameColoredParity = true;

        for (const i of coloredIdx) {
          if (sxParity[i] !== coloredParity) {
            sameColoredParity = false;
            break;
          }
        }

        let hasOppositeParity = false;

        for (const parity of sxParity) {
          if (parity !== coloredParity) {
            hasOppositeParity = true;
            break;
          }
        }

        let parityDense = true;

        for (let i = l0; i < r0; i++) {
          if (xOut[i] === 0 && sxParity[i] === coloredParity) {
            parityDense = false;
            break;
          }
        }

        negativePowerOk =
          sameColoredParity &&
          hasOppositeParity &&
          parityDense;

        if (quick && negativePowerOk) {
          // Quickでは、0点がすべて偶奇による符号反転だけで
          // 説明できる場合に限定する。
          for (let i = 0; i < leng; i++) {
            if (xOut[i] === 0 && sxParity[i] === coloredParity) {
              negativePowerOk = false;
              break;
            }
          }
        }
      }

      if (negativePowerOk) {
        const li = l0;
        const ri = r0 - 1;
        const yl = xOut[li];
        const yr = xOut[ri];

        // colored 点の (-a)^x と同符号の b だけが有効。
        const bSign = coloredParity === 0 ? 1 : -1;

        for (let t = 1; t < tokenRange; t++) {
          const bt = tokenRange - t;

          if (t > 4 || bt > 4) {
            continue;
          }

          const AAbs = gen_size(t);
          const BAbs = gen_size(bt);

          let B1Base;
          let B2Base;

          if (zeroIndex !== -1) {
            const y0 = xOut[zeroIndex];

            B1Base = BAbs.filter(
              b0 => disp(sdiv(1, bSign * b0)) === y0,
            );

            B2Base = BAbs.filter(
              b0 => disp(bSign * b0) === y0,
            );
          } else {
            B1Base = BAbs;
            B2Base = BAbs;
          }

          if (B1Base.length === 0 && B2Base.length === 0) {
            continue;
          }

          const useBByPowAndMul =
            sym === "" || sym === "~" || sym === "~-";

          for (const aAbs of AAbs) {
            const negativeA = -aAbs;
            const pl = spow(negativeA, sx[li]);
            const pr = spow(negativeA, sx[ri]);

            const canFilterByEndpoint =
              typeof pl === "number" &&
              typeof pr === "number" &&
              Number.isFinite(pl) &&
              Number.isFinite(pr) &&
              pl !== 0 &&
              pr !== 0 &&
              (pl > 0) === (pr > 0);

            let B1;
            let B2;

            if (canFilterByEndpoint) {
              const pMin = Math.min(Math.abs(pl), Math.abs(pr));
              const pMax = Math.max(Math.abs(pl), Math.abs(pr));

              const b1Low = pMax / LIMIT;
              const b1High = pMin;

              B1 = B1Base
                .filter(
                  b0 =>
                    b1Low <= b0 &&
                    b0 <= b1High &&
                    disp(sdiv(pl, bSign * b0)) === yl &&
                    disp(sdiv(pr, bSign * b0)) === yr,
                )
                .map(b0 => bSign * b0);

              if (useBByPowAndMul) {
                const b2DivLow = pMax;
                const b2DivHigh = LIMIT * pMin;

                const b2MulLow = 1 / pMin;
                const b2MulHigh = LIMIT / pMax;

                B2 = B2Base
                  .filter(
                    b0 =>
                      (
                        b2DivLow <= b0 &&
                        b0 <= b2DivHigh &&
                        disp(sdiv(bSign * b0, pl)) === yl &&
                        disp(sdiv(bSign * b0, pr)) === yr
                      ) ||
                      (
                        b2MulLow <= b0 &&
                        b0 <= b2MulHigh &&
                        disp(smul(pl, bSign * b0)) === yl &&
                        disp(smul(pr, bSign * b0)) === yr
                      ),
                  )
                  .map(b0 => bSign * b0);
              } else {
                B2 = [];
              }
            } else {
              B1 = B1Base.map(b0 => bSign * b0);
              B2 = useBByPowAndMul
                ? B2Base.map(b0 => bSign * b0)
                : [];
            }

            if (B1.length === 0 && B2.length === 0) {
              continue;
            }

            const powVals = sx.map(x => spow(negativeA, x));
            let repBase = null;

            for (const b of B1) {
              let good = true;

              for (let i = 0; i < powVals.length; i++) {
                if (disp(sdiv(powVals[i], b)) !== xOut[i]) {
                  good = false;
                  break;
                }
              }

              if (good) {
                if (repBase === null) {
                  repBase = `(${formatConstant(t, negativeA)})`;
                }

                finish(
                  `${repBase}^${sym}x/${formatConstant(bt, b)}`,
                );
              }

              reportProgress(token, sym);
            }

            for (const b of B2) {
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
                  break;
                }
              }

              let result = null;

              if (okDiv) {
                result = "div";
              } else if (okMul) {
                result = "mul";
              }

              if (result !== null) {
                if (repBase === null) {
                  repBase = `(${formatConstant(t, negativeA)})`;
                }

                const repB = formatConstant(bt, b);

                if (result === "div") {
                  finish(`${repB}/${repBase}^${sym}x`);
                } else {
                  finish(`${repBase}^${sym}x*${repB}`);
                }
              }

              reportProgress(token, sym);
            }
          }
        }
      }

      // ------------------------------------------------------
      // a^x%b
      // ------------------------------------------------------

      tokenRange = token - symLen - 3;

      ok =
        tokenRange >= 2 &&
        (zeroIndex === -1 || xOut[zeroIndex] === 1) &&
        (domNonnegative || domNonpositive);

      if (quick) {
        ok = ok && !isDense && zeroRatio < 0.5;
      }

      if (ok) {
        for (let t = 1; t < tokenRange; t++) {
          const bt = tokenRange - t;

          if (t > 4 || bt > 4) {
            continue;
          }

          const A = domNonnegative
            ? gen_size(t).filter(a => a > 1)
            : gen_size(t).filter(a => a < 1);

          const BBase = gen_size(bt).filter(b => b > maxOut);

          for (const a of A) {
            const apx = sx.map(x => spow(a, x));
            let bMax = Infinity;

            for (let i = 0; i < apx.length; i++) {
              const y = apx[i];

              if (disp(y) !== xOut[i] && y < bMax) {
                bMax = y;
              }
            }

            for (const b of BBase) {
              if (b > bMax) {
                continue;
              }

              let good = true;

              for (let i = 0; i < apx.length; i++) {
                if (disp(smod(apx[i], b)) !== xOut[i]) {
                  good = false;
                  break;
                }
              }

              if (good) {
                finish(
                  `${formatConstant(t, a)}^${sym}x%` +
                  `${formatConstant(bt, b)}`,
                );
              }

              reportProgress(token, sym);
            }
          }
        }
      }

      // ------------------------------------------------------
      // x/a%b
      // ------------------------------------------------------

      const absorbSign = sym === "-" || sym === "-~";
      const outputSym = absorbSign ? sym.slice(1) : sym;
      const denominatorSign = absorbSign ? -1 : 1;

      tokenRange = token - outputSym.length - 3;
      ok = tokenRange >= 2;

      if (quick) {
        ok =
          ok &&
          !isDense &&
          zeroRatio < 0.5 &&
          zeroIndex !== -1 &&
          xOut[zeroIndex] === 0;
      } else {
        ok =
          ok &&
          (zeroIndex === -1 || xOut[zeroIndex] === 0);
      }

      if (ok) {
        for (let t = 1; t < tokenRange; t++) {
          const bt = tokenRange - t;

          if (t > 4 || bt > 4) {
            continue;
          }

          const A = gen_size(t).filter(a => 0 < a && a < 1);
          const BBase = gen_size(bt).filter(b => b > maxOut);

          for (const a of A) {
            const xda = sx.map(x => sdiv(x, a));
            let bMax = Infinity;

            for (let i = 0; i < xda.length; i++) {
              const y = xda[i];

              if (
                y >= 0 &&
                disp(y) !== xOut[i] &&
                y < bMax
              ) {
                bMax = y;
              }
            }

            if (bMax <= maxOut) {
              continue;
            }

            for (const b of BBase) {
              if (b > bMax) {
                continue;
              }

              let good = true;

              for (let i = 0; i < xda.length; i++) {
                if (disp(smod(xda[i], b)) !== xOut[i]) {
                  good = false;
                  break;
                }
              }

              if (good) {
                const denominator = denominatorSign * a;

                finish(
                  `${outputSym}x/` +
                  `${formatConstant(t, denominator)}%` +
                  `${formatConstant(bt, b)}`,
                );
              }

              reportProgress(token, sym);
            }
          }
        }
      }

      // ------------------------------------------------------
      // a>>x&b, a>>x|b, a>>x~b,
      // a<<x&b, a<<x|b, a<<x~b
      // ------------------------------------------------------

      tokenRange = token - symLen - 3;

      if (
        tokenRange >= 2 &&
        isInt &&
        (sym === "" || sym === "~" || sym === "~-")
      ) {
        for (let t = 1; t < tokenRange; t++) {
          const bt = tokenRange - t;

          if (t > 4 || bt > 4) {
            continue;
          }

          const A = gen_int(t);
          const B = gen_int(bt);

          const shiftList = [
            ["<<", lshift],
            [">>", rshift],
          ];

          for (const [symOp1, op1] of shiftList) {
            for (const a of A) {
              const asx = sx.map(x => op1(a, x));

              for (const [symOp2, op2] of BIT_LIST) {
                for (const b of B) {
                  let good = true;

                  for (let i = 0; i < asx.length; i++) {
                    if (disp(op2(asx[i], b)) !== xOut[i]) {
                      good = false;
                      break;
                    }
                  }

                  if (good) {
                    finish(`${a}${symOp1}${sym}x${symOp2}${b}`);
                  }

                  reportProgress(token, sym);
                }
              }
            }
          }
        }
      }

      // ------------------------------------------------------
      // f(x/a)/b, f(x/a)*b, f(x*a)/b, f(x*a)*b
      // ------------------------------------------------------

      tokenRange = token - symLen - 5;
      ok = tokenRange >= 2;

      if (quick) {
        ok = ok && !isDense && zeroRatio >= 0.5;
      }

      if (ok) {
        for (let t = 1; t < tokenRange; t++) {
          const bt = tokenRange - t;

          if (t > 4 || bt > 4) {
            continue;
          }

          const A = gen_size(t);
          const B = gen_size(bt);

          for (const [symF, f] of FUNC_LIST) {
            for (const a of A) {
              let repA = null;

              for (const mode of [0, 1]) {
                const vals = [];
                let modeOk = true;
                let innerOp;

                if (mode === 0) {
                  for (const x of sx) {
                    const v = f(sdiv(x, a));

                    if (!Number.isFinite(v)) {
                      modeOk = false;
                      break;
                    }

                    vals.push(v);
                  }

                  innerOp = "/";
                } else {
                  for (const x of sx) {
                    const v = f(smul(x, a));

                    if (!Number.isFinite(v)) {
                      modeOk = false;
                      break;
                    }

                    vals.push(v);
                  }

                  innerOp = "*";
                }

                if (!modeOk) {
                  continue;
                }

                const first = vals[coloredIdx[0]];

                if (first === 0) {
                  continue;
                }

                const fPos = first > 0;

                for (let k = 1; k < coloredIdx.length; k++) {
                  const index = coloredIdx[k];
                  const value = vals[index];

                  if (value === 0 || (value > 0) !== fPos) {
                    modeOk = false;
                    break;
                  }
                }

                if (!modeOk) {
                  continue;
                }

                const useNegativeB = !fPos;
                const absVals = coloredIdx.map(
                  index => Math.abs(vals[index]),
                );

                const divLow = arrayMax(absVals) / LIMIT;
                const divHigh = arrayMin(absVals);

                let mulLow = -Infinity;
                let mulHigh = Infinity;

                for (const value of absVals) {
                  mulLow = Math.max(mulLow, 1 / value);
                  mulHigh = Math.min(mulHigh, LIMIT / value);
                }

                if (divLow > divHigh && mulLow > mulHigh) {
                  continue;
                }

                for (const b0 of B) {
                  const tryDiv = divLow <= b0 && b0 <= divHigh;
                  const tryMul = mulLow <= b0 && b0 <= mulHigh;

                  if (!tryDiv && !tryMul) {
                    continue;
                  }

                  const b = useNegativeB ? -b0 : b0;

                  if (repA === null) {
                    repA = formatConstant(t, a);
                  }

                  const repB = formatConstant(bt, b);
                  const inner =
                    innerOp === "/"
                      ? `${sym}x/${repA}`
                      : `${sym}x*${repA}`;

                  if (tryDiv) {
                    let good = true;

                    for (let i = 0; i < vals.length; i++) {
                      if (disp(sdiv(vals[i], b)) !== xOut[i]) {
                        good = false;
                        break;
                      }
                    }

                    if (good) {
                      finish(`${symF}(${inner})/${repB}`);
                    }
                  }

                  if (tryMul) {
                    let good = true;

                    for (let i = 0; i < vals.length; i++) {
                      if (disp(smul(vals[i], b)) !== xOut[i]) {
                        good = false;
                        break;
                      }
                    }

                    if (good) {
                      finish(`${symF}(${inner})*${repB}`);
                    }
                  }

                  reportProgress(token, sym);
                }
              }
            }
          }
        }
      }
    }
  }

  finishNotFound();
}

// ------------------------------------------------------------
// Message entry point
// ------------------------------------------------------------

self.addEventListener("message", event => {
  const data = event.data;

  if (!data || data.type !== "run") {
    return;
  }

  const payload = data.payload || {};

  try {
    const maxToken = Number(payload.maxToken);

    if (!Number.isInteger(maxToken) || maxToken < 3) {
      throw new Error(
        "Max token must be an integer greater than or equal to 3.",
      );
    }

    runExpressionScan(
      Array.isArray(payload.xIn) ? payload.xIn : [],
      Array.isArray(payload.xOut) ? payload.xOut : [],
      maxToken,
      Boolean(payload.quick),
    );
  } catch (error) {
    if (error instanceof ScanFinished) {
      return;
    }

    postMessage({
      type: "error",
      message:
        error && error.stack
          ? String(error.stack)
          : String(error),
    });
  }
});
