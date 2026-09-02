"use strict";

// ------------------------------------------------------------
// Dependencies
// ------------------------------------------------------------

importScripts(
  "./scan_core.js",
  "./gen_size.js",
  "./gen_size_quick.js",
);

const genSizeBroadRaw = globalThis.gen_size;
const genSizeQuickRaw = globalThis.gen_size_quick;
const genInt = globalThis.gen_int;

// ------------------------------------------------------------
// Worker protocol
// ------------------------------------------------------------

class Found extends Error {
  constructor() {
    super("Found enough expressions.");
    this.name = "Found";
  }
}

let workCounter = 0;
let foundCount = 0;
let found = false;
let maxFoundCurrent = 3;

function drop(expression) {
  postMessage({
    type: "result",
    expression: String(expression),
  });

  foundCount++;
  found = true;

  if (foundCount >= maxFoundCurrent) {
    throw new Found();
  }
}

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

function finishRun() {
  postMessage({
    type: "done",
    foundCount,
  });
}

// ------------------------------------------------------------
// Small utilities
// ------------------------------------------------------------

function isFiniteLuaNumber(value) {
  return (
    typeof value === "bigint" ||
    (
      typeof value === "number" &&
      Number.isFinite(value)
    )
  );
}

function isIntegerValue(value) {
  return (
    typeof value === "bigint" ||
    (
      typeof value === "number" &&
      Number.isFinite(value) &&
      Number.isInteger(value)
    )
  );
}

function isZero(value) {
  return value === 0 || value === 0n;
}

function isOne(value) {
  return value === 1 || value === 1n;
}

function absLua(value) {
  if (typeof value === "bigint") {
    return value < 0n ? -value : value;
  }

  return Math.abs(value);
}

function numericKey(value) {
  if (typeof value === "bigint") {
    return `i:${value}`;
  }

  if (typeof value !== "number") {
    throw new TypeError("number expected");
  }

  if (
    Number.isFinite(value) &&
    Number.isInteger(value)
  ) {
    try {
      return `i:${BigInt(value)}`;
    } catch {
      // fall through
    }
  }

  if (Number.isNaN(value)) {
    return "f:nan";
  }

  if (Object.is(value, -0)) {
    return "i:0";
  }

  return `f:${value}`;
}

function arrayMax(values) {
  let result = values[0];

  for (let i = 1; i < values.length; i++) {
    if (values[i] > result) {
      result = values[i];
    }
  }

  return result;
}

function arrayMin(values) {
  let result = values[0];

  for (let i = 1; i < values.length; i++) {
    if (values[i] < result) {
      result = values[i];
    }
  }

  return result;
}

function all(values, predicate) {
  for (const value of values) {
    if (!predicate(value)) {
      return false;
    }
  }

  return true;
}

function transformedOutputMap(sx, xOut) {
  const map = new Map();

  for (let i = 0; i < sx.length; i++) {
    map.set(
      numericKey(sx[i]),
      xOut[i],
    );
  }

  return map;
}

function indexOfNumeric(values, target) {
  const key = numericKey(target);

  for (let i = 0; i < values.length; i++) {
    if (numericKey(values[i]) === key) {
      return i;
    }
  }

  return -1;
}

function isEvenInteger(value) {
  if (typeof value === "bigint") {
    return value % 2n === 0n;
  }

  return (
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value % 2 === 0
  );
}

function normalizeInputValue(value) {
  if (typeof value === "bigint") {
    return normalizeNumber(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        "x_in must contain finite numbers."
      );
    }

    if (Number.isSafeInteger(value)) {
      return BigInt(value);
    }

    return value;
  }

  if (typeof value === "string") {
    const parsed = luaLiteralValue(value);

    if (!isFiniteLuaNumber(parsed)) {
      throw new Error(
        "x_in must contain finite numbers."
      );
    }

    return parsed;
  }

  if (
    value &&
    typeof value === "object"
  ) {
    if (value.type === "int") {
      return normalizeNumber(
        BigInt(value.value)
      );
    }

    if (value.type === "float") {
      const parsed = Number(value.value);

      if (!Number.isFinite(parsed)) {
        throw new Error(
          "x_in must contain finite numbers."
        );
      }

      return parsed;
    }
  }

  throw new Error(
    "x_in must contain finite numbers."
  );
}

function hasDuplicateNumbers(values) {
  const seen = new Set();

  for (const value of values) {
    const key = numericKey(value);

    if (seen.has(key)) {
      return true;
    }

    seen.add(key);
  }

  return false;
}

function formatInteger(value) {
  return String(value);
}

const FUNC_LIST_SCAN = [
  ["sin", luaSin],
  ["cos", luaCos],
  ["tan", luaTan],
];

const BIT_LIST = [
  ["&", band],
  ["|", bor],
  ["~", bxor],
];

// ------------------------------------------------------------
// Core scan
// ------------------------------------------------------------

function runExpressionScan(
  rawXIn,
  rawXOut,
  maxToken,
  quick,
  maxFound,
) {
  let xIn = rawXIn.map(
    normalizeInputValue
  );

  let xOut = rawXOut.slice();

  if (xIn.length !== xOut.length) {
    throw new Error(
      "Please make x_in and x_out the same length."
    );
  }

  const leng = xIn.length;

  if (leng === 0) {
    throw new Error(
      "Please enter at least one input pair."
    );
  }

  if (hasDuplicateNumbers(xIn)) {
    throw new Error(
      "x_in contains duplicate values."
    );
  }

  if (
    !xOut.every(
      x =>
        Number.isInteger(x) &&
        0 <= x &&
        x <= 16
    )
  ) {
    throw new Error(
      "x_out must contain integers from 0 to 16."
    );
  }

  foundCount = 0;
  found = false;
  maxFoundCurrent = maxFound;
  workCounter = 0;

  const numColor =
    new Set(xOut).size;

  if (numColor <= 1) {
    drop(xOut[0]);
    throw new Found();
  }

  const maxOut =
    Math.max(...xOut);

  let zeroCount = 0;

  for (const value of xOut) {
    if (value === 0) {
      zeroCount++;
    }
  }

  const zeroRatio =
    zeroCount / leng;

  const pairs =
    xIn.map(
      (xi, i) => [xi, xOut[i]]
    );

  pairs.sort(
    (a, b) =>
      a[0] < b[0]
        ? -1
        : a[0] > b[0]
          ? 1
          : 0
  );

  xIn =
    pairs.map(pair => pair[0]);

  xOut =
    pairs.map(pair => pair[1]);

  const coloredIdx = [];

  for (let i = 0; i < leng; i++) {
    if (xOut[i] > 0) {
      coloredIdx.push(i);
    }
  }

  const isInt =
    xIn.every(isIntegerValue);

  const sList = [
    xIn,
    xIn.map(x => sneg(x)),
  ];

  const sStr = ["", "-"];

  if (isInt) {
    sList.push(
      xIn.map(x => bnot(x)),
      xIn.map(
        x => sneg(bnot(x))
      ),
      xIn.map(
        x => bnot(sneg(x))
      ),
    );

    sStr.push(
      "~",
      "-~",
      "~-",
    );
  }

  let l0 = 0;
  let r0 = leng;

  while (xOut[l0] === 0) {
    l0++;
  }

  while (xOut[r0 - 1] === 0) {
    r0--;
  }

  const xCod =
    xOut.slice(l0, r0);

  const isDense =
    !xCod.includes(0);

  const rawGenSize =
    quick
      ? genSizeQuickRaw
      : genSizeBroadRaw;

  const positiveCache =
    new Map();

  const negativeCache =
    new Map();

  function genSize(tokenSize) {
    if (
      positiveCache.has(
        tokenSize
      )
    ) {
      return positiveCache.get(
        tokenSize
      );
    }

    const out =
      rawGenSize(tokenSize)
        .filter(
          ([, a]) => a > 0
        );

    positiveCache.set(
      tokenSize,
      out
    );

    return out;
  }

  function genSizeNeg(tokenSize) {
    if (
      negativeCache.has(
        tokenSize
      )
    ) {
      return negativeCache.get(
        tokenSize
      );
    }

    let out;

    if (quick) {
      out =
        genSize(tokenSize)
          .map(
            ([rep, a]) => [
              `-${rep}`,
              sneg(a),
            ]
          );
    } else {
      out =
        rawGenSize(tokenSize)
          .filter(
            ([, a]) => a < 0
          );
    }

    negativeCache.set(
      tokenSize,
      out
    );

    return out;
  }

  for (
    let token = 3;
    token <= maxToken;
    token++
  ) {
    if (found) {
      throw new Found();
    }

    reportProgress(
      token,
      null,
      true
    );

    for (
      let si = 0;
      si < sList.length;
      si++
    ) {
      const sym = sStr[si];
      const sx = sList[si];
      const symLen = sym.length;

      const xDom =
        sx.slice(l0, r0);

      const zeroIndex =
        indexOfNumeric(
          sx,
          0n
        );

      const oneIndex =
        indexOfNumeric(
          sx,
          1n
        );

      const minusOneIndex =
        indexOfNumeric(
          sx,
          -1n
        );

      const unitIndex =
        oneIndex !== -1
          ? oneIndex
          : minusOneIndex;

      const sxToOut =
        transformedOutputMap(
          sx,
          xOut
        );

      let isEvenCompatible = true;

      for (
        let i = 0;
        i < sx.length;
        i++
      ) {
        const oppositeKey =
          numericKey(
            sneg(sx[i])
          );

        if (
          sxToOut.has(
            oppositeKey
          ) &&
          sxToOut.get(
            oppositeKey
          ) !== xOut[i]
        ) {
          isEvenCompatible = false;
          break;
        }
      }

      const inc =
        sx[0] <
        sx[sx.length - 1];

      let belowDom;
      let aboveDom;

      if (inc) {
        belowDom =
          sx.slice(0, l0);

        aboveDom =
          sx.slice(r0);
      } else {
        belowDom =
          sx.slice(r0);

        aboveDom =
          sx.slice(0, l0);
      }

      const domPositive =
        all(
          xDom,
          x => x > 0
        );

      const domNonnegative =
        all(
          xDom,
          x => x >= 0
        );

      const domNonpositive =
        all(
          xDom,
          x => x <= 0
        );

      const belowNegative =
        all(
          belowDom,
          x => x < 0
        );

      const belowNonpositive =
        all(
          belowDom,
          x => x <= 0
        );

      const abovePositive =
        all(
          aboveDom,
          x => x > 0
        );

      const aboveNonnegative =
        all(
          aboveDom,
          x => x >= 0
        );

      // 0^x
      let zeroPowOk = true;

      for (
        let i = 0;
        i < sx.length;
        i++
      ) {
        const expected =
          isZero(sx[i])
            ? 1
            : 0;

        if (
          xOut[i] !== expected
        ) {
          zeroPowOk = false;
          break;
        }
      }

      const zeroPowToken =
        symLen + 3;

      if (
        token ===
          zeroPowToken &&
        zeroPowOk
      ) {
        drop(
          `0^${sym}x`
        );
      }

      // a+x / a-x
      if (
        isDense &&
        token === 3 &&
        (
          sym === "" ||
          sym === "-"
        )
      ) {
        let A;

        if (isInt) {
          A =
            genInt(1)
              .map(
                a => [
                  formatInteger(a),
                  a,
                ]
              );
        } else {
          A =
            genSize(1)
              .concat(
                genSizeNeg(1)
              );
        }

        for (
          const [repA, a]
          of A
        ) {
          let good = true;

          for (
            let i = 0;
            i < sx.length;
            i++
          ) {
            if (
              disp(
                sadd(
                  a,
                  sx[i]
                )
              ) !==
              xOut[i]
            ) {
              good = false;
              break;
            }
          }

          if (good) {
            if (sym === "") {
              drop(
                `${repA}+x`
              );
            } else {
              drop(
                `${repA}-x`
              );
            }
          }

          reportProgress(
            token,
            sym
          );
        }
      }

      // a^x
      let tokenRange =
        token -
        symLen -
        2;

      if (
        isDense &&
        1 <= tokenRange &&
        tokenRange <= 4 &&
        (
          zeroIndex === -1 ||
          xOut[zeroIndex] === 1
        )
      ) {
        let A = [];

        if (
          domNonnegative &&
          belowNegative
        ) {
          if (inc) {
            if (r0 < leng) {
              const border =
                LIMIT **
                (
                  1 /
                  toFloat(
                    sx[r0]
                  )
                );

              A =
                genSize(
                  tokenRange
                )
                  .filter(
                    ([, a]) =>
                      a >= border
                  );
            } else {
              const border =
                LIMIT **
                (
                  1 /
                  toFloat(
                    sx[
                      sx.length - 1
                    ]
                  )
                );

              A =
                genSize(
                  tokenRange
                )
                  .filter(
                    ([, a]) =>
                      1 < a &&
                      a < border
                  );
            }
          } else if (
            l0 > 0
          ) {
            const border =
              LIMIT **
              (
                1 /
                toFloat(
                  sx[l0 - 1]
                )
              );

            A =
              genSize(
                tokenRange
              )
                .filter(
                  ([, a]) =>
                    a >= border
                );
          } else {
            const border =
              LIMIT **
              (
                1 /
                toFloat(sx[0])
              );

            A =
              genSize(
                tokenRange
              )
                .filter(
                  ([, a]) =>
                    1 < a &&
                    a < border
                );
          }
        } else if (
          domNonpositive &&
          abovePositive
        ) {
          if (inc) {
            if (l0 > 0) {
              const border =
                LIMIT **
                (
                  1 /
                  toFloat(
                    sx[l0 - 1]
                  )
                );

              A =
                genSize(
                  tokenRange
                )
                  .filter(
                    ([, a]) =>
                      a <= border
                  );
            } else {
              const border =
                LIMIT **
                (
                  1 /
                  toFloat(sx[0])
                );

              A =
                genSize(
                  tokenRange
                )
                  .filter(
                    ([, a]) =>
                      border < a &&
                      a < 1
                  );
            }
          } else if (
            r0 < leng
          ) {
            const border =
              LIMIT **
              (
                1 /
                toFloat(
                  sx[r0]
                )
              );

            A =
              genSize(
                tokenRange
              )
                .filter(
                  ([, a]) =>
                    a <= border
                );
          } else {
            const border =
              LIMIT **
              (
                1 /
                toFloat(
                  sx[
                    sx.length - 1
                  ]
                )
              );

            A =
              genSize(
                tokenRange
              )
                .filter(
                  ([, a]) =>
                    border < a &&
                    a < 1
                );
          }
        }

        for (
          const [repA, a]
          of A
        ) {
          let good = true;

          for (
            let i = 0;
            i < sx.length;
            i++
          ) {
            if (
              disp(
                spow(
                  a,
                  sx[i]
                )
              ) !==
              xOut[i]
            ) {
              good = false;
              break;
            }
          }

          if (good) {
            drop(
              `${repA}^${sym}x`
            );
          }

          reportProgress(
            token,
            sym
          );
        }
      }

      // x/a
      tokenRange =
        token -
        symLen -
        2;

      let ok =
        isDense &&
        1 <= tokenRange &&
        tokenRange <= 4 &&
        (
          (
            domNonnegative &&
            belowNonpositive
          ) ||
          (
            domNonpositive &&
            aboveNonnegative
          )
        ) &&
        (
          sym === "" ||
          sym === "~" ||
          sym === "~-"
        );

      if (quick) {
        ok =
          ok &&
          zeroIndex !== -1 &&
          xOut[zeroIndex] === 0;
      } else {
        ok =
          ok &&
          (
            zeroIndex === -1 ||
            xOut[zeroIndex] === 0
          );
      }

      if (ok) {
        let A;

        if (
          domNonnegative &&
          domNonpositive
        ) {
          drop(0);
          A = [];
        } else if (
          domNonnegative &&
          belowNonpositive
        ) {
          const maximum =
            toFloat(
              arrayMax(xDom)
            );

          A =
            genSize(
              tokenRange
            )
              .filter(
                ([, a]) =>
                  maximum /
                    LIMIT <
                    a &&
                  a < 1
              );
        } else {
          const minimum =
            toFloat(
              arrayMin(xDom)
            );

          A =
            genSizeNeg(
              tokenRange
            )
              .filter(
                ([, a]) =>
                  -minimum /
                    LIMIT <
                    -toFloat(a) &&
                  -toFloat(a) <
                    1
              );
        }

        for (
          const [repA, a]
          of A
        ) {
          let good = true;

          for (
            let i = 0;
            i < sx.length;
            i++
          ) {
            if (
              disp(
                sdiv(
                  sx[i],
                  a
                )
              ) !==
              xOut[i]
            ) {
              good = false;
              break;
            }
          }

          if (good) {
            drop(
              `${sym}x/${repA}`
            );
          }

          reportProgress(
            token,
            sym
          );
        }
      }

      // x^a
      const parenToken =
        sym ? 1 : 0;

      tokenRange =
        token -
        symLen -
        parenToken -
        2;

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
          (
            zeroIndex === -1 ||
            xOut[zeroIndex] === 0
          ) &&
          (
            oneIndex === -1 ||
            xOut[oneIndex] === 1
          );

        evenPowerOk =
          evenPowerOk &&
          (
            zeroIndex === -1 ||
            xOut[zeroIndex] === 0
          ) &&
          (
            unitIndex === -1 ||
            xOut[unitIndex] === 1
          );
      }

      if (
        positivePowerOk ||
        evenPowerOk
      ) {
        const G =
          genSize(
            tokenRange
          );

        const A = [];
        const seenA =
          new Set();

        if (positivePowerOk) {
          let impossible = false;
          let aLow = 0;
          let aHigh = Infinity;

          for (
            let i = 0;
            i < xDom.length;
            i++
          ) {
            const x =
              toFloat(
                xDom[i]
              );

            const y =
              xCod[i];

            if (
              0 < x &&
              x < 1
            ) {
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

            const logX =
              Math.log(x);

            aLow =
              Math.max(
                aLow,
                Math.log(y) /
                  logX
              );

            aHigh =
              Math.min(
                aHigh,
                Math.log(LIMIT) /
                  logX
              );
          }

          if (
            !impossible &&
            aLow < aHigh
          ) {
            for (
              const [repA, a]
              of G
            ) {
              const key =
                numericKey(a);

              if (
                aLow <= a &&
                a < aHigh &&
                !seenA.has(key)
              ) {
                seenA.add(key);

                A.push([
                  repA,
                  a,
                ]);
              }
            }
          }
        }

        if (evenPowerOk) {
          let impossible = false;
          let aLow = 0;
          let aHigh = Infinity;

          for (
            const i
            of coloredIdx
          ) {
            const x =
              Math.abs(
                toFloat(sx[i])
              );

            const y =
              xOut[i];

            if (
              x === 0 ||
              (
                0 < x &&
                x < 1
              )
            ) {
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

            const logX =
              Math.log(x);

            aLow =
              Math.max(
                aLow,
                Math.log(y) /
                  logX
              );

            aHigh =
              Math.min(
                aHigh,
                Math.log(LIMIT) /
                  logX
              );
          }

          if (
            !impossible &&
            aLow < aHigh
          ) {
            for (
              const [repA, a]
              of G
            ) {
              const key =
                numericKey(a);

              if (
                isEvenInteger(a) &&
                aLow <= a &&
                a < aHigh &&
                !seenA.has(key)
              ) {
                seenA.add(key);

                A.push([
                  repA,
                  a,
                ]);
              }
            }
          }
        }

        for (
          const [repA, a]
          of A
        ) {
          let good = true;

          for (
            let i = 0;
            i < sx.length;
            i++
          ) {
            if (
              disp(
                spow(
                  sx[i],
                  a
                )
              ) !==
              xOut[i]
            ) {
              good = false;
              break;
            }
          }

          if (good) {
            if (sym === "") {
              drop(
                `x^${repA}`
              );
            } else {
              drop(
                `(${sym}x)^${repA}`
              );
            }
          }

          reportProgress(
            token,
            sym
          );
        }
      }

      // x%a
      tokenRange =
        token -
        symLen -
        2;

      if (
        1 <= tokenRange &&
        tokenRange <= 2
      ) {
        const G =
          genSize(
            tokenRange
          );

        let A;

        if (
          all(
            sx,
            x => x >= 0
          )
        ) {
          const sxMax =
            arrayMax(sx);

          A =
            G.filter(
              ([, a]) =>
                1 < a &&
                a <= sxMax
            );
        } else {
          A =
            G.filter(
              ([, a]) =>
                1 < a
            );
        }

        for (
          const [repA, a]
          of A
        ) {
          let good = true;

          for (
            let i = 0;
            i < sx.length;
            i++
          ) {
            if (
              disp(
                smod(
                  sx[i],
                  a
                )
              ) !==
              xOut[i]
            ) {
              good = false;
              break;
            }
          }

          if (good) {
            drop(
              `${sym}x%${repA}`
            );
          }

          reportProgress(
            token,
            sym
          );
        }
      }

      // a%x
      tokenRange =
        token -
        symLen -
        2;

      if (
        1 <= tokenRange &&
        tokenRange <= 2
      ) {
        const A =
          genSize(tokenRange)
            .filter(
              ([, a]) =>
                a > 1
            )
            .concat(
              genSizeNeg(
                tokenRange
              )
                .filter(
                  ([, a]) =>
                    a < -1
                )
            );

        for (
          const [repA, a]
          of A
        ) {
          let good = true;

          for (
            let i = 0;
            i < sx.length;
            i++
          ) {
            let v;

            try {
              v =
                smod(
                  a,
                  sx[i]
                );
            } catch (error) {
              if (
                error instanceof
                  LuaRuntimeError
              ) {
                good = false;
                break;
              }

              throw error;
            }

            if (
              disp(v) !==
              xOut[i]
            ) {
              good = false;
              break;
            }
          }

          if (good) {
            drop(
              `${repA}%${sym}x`
            );
          }

          reportProgress(
            token,
            sym
          );
        }
      }

      // x&a, x|a, x~a
      tokenRange =
        token -
        symLen -
        2;

      if (
        1 <= tokenRange &&
        tokenRange <= 4 &&
        isInt
      ) {
        for (
          const [symOp, op]
          of BIT_LIST
        ) {
          for (
            const a
            of genInt(
              tokenRange
            )
          ) {
            let good = true;

            for (
              let i = 0;
              i < sx.length;
              i++
            ) {
              if (
                disp(
                  op(
                    sx[i],
                    a
                  )
                ) !==
                xOut[i]
              ) {
                good = false;
                break;
              }
            }

            if (good) {
              drop(
                `${sym}x${symOp}${a}`
              );
            }

            reportProgress(
              token,
              sym
            );
          }
        }
      }

      // a^x/b, b/a^x, a^x*b
      tokenRange =
        token -
        symLen -
        3;

      if (
        isDense &&
        tokenRange >= 2
      ) {
        const li = l0;
        const ri = r0 - 1;

        const yl =
          xOut[li];

        const yr =
          xOut[ri];

        for (
          let t = 1;
          t < tokenRange;
          t++
        ) {
          const bt =
            tokenRange - t;

          if (
            t > 4 ||
            bt > 4
          ) {
            continue;
          }

          const A =
            genSize(t);

          const B =
            genSize(bt);

          let B1Base;
          let B2Base;

          if (
            zeroIndex !== -1
          ) {
            const y0 =
              xOut[zeroIndex];

            B1Base =
              B.filter(
                ([, b]) =>
                  disp(
                    sdiv(
                      1n,
                      b
                    )
                  ) === y0
              );

            B2Base =
              B.filter(
                ([, b]) =>
                  disp(b) === y0
              );
          } else {
            B1Base = B;
            B2Base = B;
          }

          if (
            B1Base.length === 0 &&
            B2Base.length === 0
          ) {
            continue;
          }

          const useBByPowAndMul =
            sym === "" ||
            sym === "~" ||
            sym === "~-";

          for (
            const [repA, a]
            of A
          ) {
            const pl =
              spow(
                a,
                sx[li]
              );

            const pr =
              spow(
                a,
                sx[ri]
              );

            const canFilterByEndpoint =
              isFiniteLuaNumber(pl) &&
              isFiniteLuaNumber(pr) &&
              pl > 0 &&
              pr > 0;

            let B1;
            let B2;

            if (
              canFilterByEndpoint
            ) {
              const pln =
                toFloat(pl);

              const prn =
                toFloat(pr);

              const pMin =
                Math.min(
                  pln,
                  prn
                );

              const pMax =
                Math.max(
                  pln,
                  prn
                );

              const b1Low =
                pMax / LIMIT;

              const b1High =
                pMin;

              B1 =
                B1Base.filter(
                  ([, b]) =>
                    b1Low <= b &&
                    b <= b1High &&
                    disp(
                      sdiv(
                        pl,
                        b
                      )
                    ) === yl &&
                    disp(
                      sdiv(
                        pr,
                        b
                      )
                    ) === yr
                );

              if (
                useBByPowAndMul
              ) {
                const b2DivLow =
                  pMax;

                const b2DivHigh =
                  LIMIT * pMin;

                const b2MulLow =
                  1 / pMin;

                const b2MulHigh =
                  LIMIT / pMax;

                B2 =
                  B2Base.filter(
                    ([, b]) =>
                      (
                        b2DivLow <=
                          b &&
                        b <=
                          b2DivHigh &&
                        disp(
                          sdiv(
                            b,
                            pl
                          )
                        ) === yl &&
                        disp(
                          sdiv(
                            b,
                            pr
                          )
                        ) === yr
                      ) ||
                      (
                        b2MulLow <=
                          b &&
                        b <=
                          b2MulHigh &&
                        disp(
                          smul(
                            pl,
                            b
                          )
                        ) === yl &&
                        disp(
                          smul(
                            pr,
                            b
                          )
                        ) === yr
                      )
                  );
              } else {
                B2 = [];
              }
            } else {
              B1 = B1Base;

              B2 =
                useBByPowAndMul
                  ? B2Base
                  : [];
            }

            if (
              B1.length === 0 &&
              B2.length === 0
            ) {
              continue;
            }

            const powVals =
              sx.map(
                x =>
                  spow(
                    a,
                    x
                  )
              );

            for (
              const [repB, b]
              of B1
            ) {
              let good = true;

              for (
                let i = 0;
                i < powVals.length;
                i++
              ) {
                if (
                  disp(
                    sdiv(
                      powVals[i],
                      b
                    )
                  ) !==
                  xOut[i]
                ) {
                  good = false;
                  break;
                }
              }

              if (good) {
                drop(
                  `${repA}^${sym}x/${repB}`
                );
              }

              reportProgress(
                token,
                sym
              );
            }

            for (
              const [repB, b]
              of B2
            ) {
              let okDiv = true;
              let okMul = true;

              for (
                let i = 0;
                i < powVals.length;
                i++
              ) {
                const p =
                  powVals[i];

                const y =
                  xOut[i];

                if (
                  okDiv &&
                  disp(
                    sdiv(
                      b,
                      p
                    )
                  ) !== y
                ) {
                  okDiv = false;
                }

                if (
                  okMul &&
                  disp(
                    smul(
                      p,
                      b
                    )
                  ) !== y
                ) {
                  okMul = false;
                }

                if (
                  !okDiv &&
                  !okMul
                ) {
                  break;
                }
              }

              if (okDiv) {
                drop(
                  `${repB}/${repA}^${sym}x`
                );
              } else if (okMul) {
                drop(
                  `${repA}^${sym}x*${repB}`
                );
              }

              reportProgress(
                token,
                sym
              );
            }
          }
        }
      }

      // (-a)^x/b, b/(-a)^x, (-a)^x*b
      tokenRange =
        token -
        symLen -
        4;

      let negativePowerOk = false;
      let coloredParity = null;
      let sxParity = null;

      if (
        isInt &&
        tokenRange >= 2
      ) {
        sxParity =
          sx.map(
            x =>
              Number(
                toInteger(x) &
                1n
              )
          );

        coloredParity =
          sxParity[
            coloredIdx[0]
          ];

        const sameColoredParity =
          coloredIdx.every(
            i =>
              sxParity[i] ===
              coloredParity
          );

        const hasOppositeParity =
          sxParity.some(
            parity =>
              parity !==
              coloredParity
          );

        let parityDense = true;

        for (
          let i = l0;
          i < r0;
          i++
        ) {
          if (
            xOut[i] === 0 &&
            sxParity[i] ===
              coloredParity
          ) {
            parityDense = false;
            break;
          }
        }

        negativePowerOk =
          sameColoredParity &&
          hasOppositeParity &&
          parityDense;

        if (
          quick &&
          negativePowerOk
        ) {
          for (
            let i = 0;
            i < leng;
            i++
          ) {
            if (
              xOut[i] === 0 &&
              sxParity[i] ===
                coloredParity
            ) {
              negativePowerOk =
                false;

              break;
            }
          }
        }
      }

      if (negativePowerOk) {
        const li = l0;
        const ri = r0 - 1;

        const yl =
          xOut[li];

        const yr =
          xOut[ri];

        const bSign =
          coloredParity === 0
            ? 1
            : -1;

        for (
          let t = 1;
          t < tokenRange;
          t++
        ) {
          const bt =
            tokenRange - t;

          if (
            t > 4 ||
            bt > 4
          ) {
            continue;
          }

          const AAbs =
            genSizeNeg(t)
              .map(
                ([repA, a]) => [
                  repA,
                  sneg(a),
                ]
              );

          const BAbs =
            bSign === 1
              ? genSize(bt)
              : genSizeNeg(bt)
                  .map(
                    ([repB, b]) => [
                      repB,
                      sneg(b),
                    ]
                  );

          let B1Base;
          let B2Base;

          if (
            zeroIndex !== -1
          ) {
            const y0 =
              xOut[zeroIndex];

            B1Base =
              BAbs.filter(
                ([, b0]) => {
                  const b =
                    bSign === 1
                      ? b0
                      : sneg(b0);

                  return (
                    disp(
                      sdiv(
                        1n,
                        b
                      )
                    ) === y0
                  );
                }
              );

            B2Base =
              BAbs.filter(
                ([, b0]) => {
                  const b =
                    bSign === 1
                      ? b0
                      : sneg(b0);

                  return (
                    disp(b) === y0
                  );
                }
              );
          } else {
            B1Base = BAbs;
            B2Base = BAbs;
          }

          if (
            B1Base.length === 0 &&
            B2Base.length === 0
          ) {
            continue;
          }

          const useBByPowAndMul =
            sym === "" ||
            sym === "~" ||
            sym === "~-";

          for (
            const [repA, aAbs]
            of AAbs
          ) {
            const negativeA =
              sneg(aAbs);

            const pl =
              spow(
                negativeA,
                sx[li]
              );

            const pr =
              spow(
                negativeA,
                sx[ri]
              );

            const canFilterByEndpoint =
              isFiniteLuaNumber(pl) &&
              isFiniteLuaNumber(pr) &&
              !isZero(pl) &&
              !isZero(pr) &&
              (
                (pl > 0) ===
                (pr > 0)
              );

            let B1;
            let B2;

            if (
              canFilterByEndpoint
            ) {
              const pMin =
                Math.min(
                  Math.abs(
                    toFloat(pl)
                  ),
                  Math.abs(
                    toFloat(pr)
                  )
                );

              const pMax =
                Math.max(
                  Math.abs(
                    toFloat(pl)
                  ),
                  Math.abs(
                    toFloat(pr)
                  )
                );

              const b1Low =
                pMax / LIMIT;

              const b1High =
                pMin;

              B1 =
                B1Base
                  .filter(
                    ([, b0]) => {
                      const b =
                        bSign === 1
                          ? b0
                          : sneg(b0);

                      return (
                        b1Low <= b0 &&
                        b0 <= b1High &&
                        disp(
                          sdiv(
                            pl,
                            b
                          )
                        ) === yl &&
                        disp(
                          sdiv(
                            pr,
                            b
                          )
                        ) === yr
                      );
                    }
                  )
                  .map(
                    ([repB, b0]) => [
                      repB,
                      bSign === 1
                        ? b0
                        : sneg(b0),
                    ]
                  );

              if (
                useBByPowAndMul
              ) {
                const b2DivLow =
                  pMax;

                const b2DivHigh =
                  LIMIT * pMin;

                const b2MulLow =
                  1 / pMin;

                const b2MulHigh =
                  LIMIT / pMax;

                B2 =
                  B2Base
                    .filter(
                      ([, b0]) => {
                        const b =
                          bSign === 1
                            ? b0
                            : sneg(b0);

                        return (
                          (
                            b2DivLow <=
                              b0 &&
                            b0 <=
                              b2DivHigh &&
                            disp(
                              sdiv(
                                b,
                                pl
                              )
                            ) === yl &&
                            disp(
                              sdiv(
                                b,
                                pr
                              )
                            ) === yr
                          ) ||
                          (
                            b2MulLow <=
                              b0 &&
                            b0 <=
                              b2MulHigh &&
                            disp(
                              smul(
                                pl,
                                b
                              )
                            ) === yl &&
                            disp(
                              smul(
                                pr,
                                b
                              )
                            ) === yr
                          )
                        );
                      }
                    )
                    .map(
                      ([repB, b0]) => [
                        repB,
                        bSign === 1
                          ? b0
                          : sneg(b0),
                      ]
                    );
              } else {
                B2 = [];
              }
            } else {
              B1 =
                B1Base.map(
                  ([repB, b0]) => [
                    repB,
                    bSign === 1
                      ? b0
                      : sneg(b0),
                  ]
                );

              B2 =
                useBByPowAndMul
                  ? B2Base.map(
                      ([repB, b0]) => [
                        repB,
                        bSign === 1
                          ? b0
                          : sneg(b0),
                      ]
                    )
                  : [];
            }

            if (
              B1.length === 0 &&
              B2.length === 0
            ) {
              continue;
            }

            const powVals =
              sx.map(
                x =>
                  spow(
                    negativeA,
                    x
                  )
              );

            const repBase =
              `(${repA})`;

            for (
              const [repB, b]
              of B1
            ) {
              let good = true;

              for (
                let i = 0;
                i < powVals.length;
                i++
              ) {
                if (
                  disp(
                    sdiv(
                      powVals[i],
                      b
                    )
                  ) !==
                  xOut[i]
                ) {
                  good = false;
                  break;
                }
              }

              if (good) {
                drop(
                  `${repBase}^${sym}x/${repB}`
                );
              }

              reportProgress(
                token,
                sym
              );
            }

            for (
              const [repB, b]
              of B2
            ) {
              let okDiv = true;
              let okMul = true;

              for (
                let i = 0;
                i < powVals.length;
                i++
              ) {
                const p =
                  powVals[i];

                const y =
                  xOut[i];

                if (
                  okDiv &&
                  disp(
                    sdiv(
                      b,
                      p
                    )
                  ) !== y
                ) {
                  okDiv = false;
                }

                if (
                  okMul &&
                  disp(
                    smul(
                      p,
                      b
                    )
                  ) !== y
                ) {
                  okMul = false;
                }

                if (
                  !okDiv &&
                  !okMul
                ) {
                  break;
                }
              }

              if (okDiv) {
                drop(
                  `${repB}/${repBase}^${sym}x`
                );
              } else if (okMul) {
                drop(
                  `${repBase}^${sym}x*${repB}`
                );
              }

              reportProgress(
                token,
                sym
              );
            }
          }
        }
      }

      // (a+x)^b / (a-x)^b
      tokenRange =
        token - 4;

      if (
        !quick &&
        (
          sym === "" ||
          sym === "-"
        ) &&
        tokenRange >= 2
      ) {
        const logLimit =
          Math.log(LIMIT);

        const allSxInt =
          sx.every(
            x =>
              typeof x ===
              "bigint"
          );

        let generalALow = null;
        let forbidden = null;

        if (allSxInt) {
          generalALow =
            coloredIdx
              .map(
                i =>
                  1n -
                  sx[i]
              )
              .reduce(
                (a, b) =>
                  a > b
                    ? a
                    : b
              );

          const intervals =
            coloredIdx
              .map(
                i => [
                  -1n - sx[i],
                  1n - sx[i],
                ]
              )
              .sort(
                (a, b) =>
                  a[0] < b[0]
                    ? -1
                    : a[0] >
                        b[0]
                      ? 1
                      : 0
              );

          forbidden = [];

          for (
            const [lo, hi]
            of intervals
          ) {
            if (
              forbidden.length >
                0 &&
              lo <
                forbidden[
                  forbidden.length -
                    1
                ][1]
            ) {
              if (
                hi >
                forbidden[
                  forbidden.length -
                    1
                ][1]
              ) {
                forbidden[
                  forbidden.length -
                    1
                ][1] = hi;
              }
            } else {
              forbidden.push([
                lo,
                hi,
              ]);
            }
          }
        }

        for (
          let t = 1;
          t < tokenRange;
          t++
        ) {
          const bt =
            tokenRange - t;

          if (
            t > 4 ||
            bt > 4
          ) {
            continue;
          }

          const A =
            genSize(t);

          const B =
            genSize(bt);

          const BEven =
            B.filter(
              ([, b]) =>
                isEvenInteger(b)
            );

          for (
            const [repA, a]
            of A
          ) {
            const linearSafe =
              typeof a ===
                "bigint" &&
              allSxInt &&
              sx.every(
                x =>
                  INT_MIN <=
                    a + x &&
                  a + x <=
                    INT_MAX
              );

            let generalPossible =
              true;

            let evenPossible =
              true;

            if (linearSafe) {
              generalPossible =
                a >=
                generalALow;

              evenPossible =
                !forbidden.some(
                  ([lo, hi]) =>
                    lo < a &&
                    a < hi
                );

              if (
                !generalPossible &&
                !evenPossible
              ) {
                continue;
              }
            }

            const bases =
              sx.map(
                x =>
                  sadd(
                    a,
                    x
                  )
              );

            const coloredBases =
              coloredIdx.map(
                i =>
                  bases[i]
              );

            if (
              coloredBases.some(
                base =>
                  !isFiniteLuaNumber(
                    base
                  ) ||
                  absLua(base) < 1
              )
            ) {
              continue;
            }

            if (
              coloredBases.some(
                base =>
                  base < 0
              )
            ) {
              generalPossible =
                false;
            } else {
              evenPossible =
                false;
            }

            const candidateB = [];
            const seenB =
              new Set();

            if (generalPossible) {
              let bLow = 0;
              let bHigh = Infinity;
              let possible = true;

              for (
                let i = 0;
                i < bases.length;
                i++
              ) {
                const base =
                  bases[i];

                const color =
                  xOut[i];

                if (color > 0) {
                  if (
                    !isFiniteLuaNumber(
                      base
                    ) ||
                    base < 1
                  ) {
                    possible = false;
                    break;
                  }

                  if (
                    isOne(base)
                  ) {
                    if (
                      color !== 1
                    ) {
                      possible = false;
                      break;
                    }

                    continue;
                  }

                  const logBase =
                    Math.log(
                      toFloat(base)
                    );

                  bLow =
                    Math.max(
                      bLow,
                      Math.log(color) /
                        logBase
                    );

                  bHigh =
                    Math.min(
                      bHigh,
                      logLimit /
                        logBase
                    );
                } else {
                  if (
                    isOne(base)
                  ) {
                    possible = false;
                    break;
                  }

                  if (base > 1) {
                    bLow =
                      Math.max(
                        bLow,
                        logLimit /
                          Math.log(
                            toFloat(
                              base
                            )
                          )
                      );
                  }
                }

                if (
                  bLow >= bHigh
                ) {
                  possible = false;
                  break;
                }
              }

              if (possible) {
                for (
                  const [repB, b]
                  of B
                ) {
                  if (
                    bLow <= b &&
                    b < bHigh
                  ) {
                    seenB.add(
                      numericKey(b)
                    );

                    candidateB.push([
                      repB,
                      b,
                    ]);
                  }
                }
              }
            }

            if (
              evenPossible &&
              BEven.length > 0
            ) {
              let bLow = 0;
              let bHigh = Infinity;
              let possible = true;

              const magnitudeToColor =
                new Map();

              for (
                let i = 0;
                i < bases.length;
                i++
              ) {
                const magnitude =
                  absLua(
                    bases[i]
                  );

                const color =
                  xOut[i];

                const key =
                  numericKey(
                    magnitude
                  );

                if (
                  magnitudeToColor.has(
                    key
                  ) &&
                  magnitudeToColor.get(
                    key
                  ) !== color
                ) {
                  possible = false;
                  break;
                }

                magnitudeToColor.set(
                  key,
                  color
                );

                if (color > 0) {
                  if (
                    !isFiniteLuaNumber(
                      magnitude
                    ) ||
                    magnitude < 1
                  ) {
                    possible = false;
                    break;
                  }

                  if (
                    isOne(
                      magnitude
                    )
                  ) {
                    if (
                      color !== 1
                    ) {
                      possible = false;
                      break;
                    }

                    continue;
                  }

                  const logMagnitude =
					Math.log(
					  Number(magnitude)
					);

                  bLow =
                    Math.max(
                      bLow,
                      Math.log(color) /
                        logMagnitude
                    );

                  bHigh =
                    Math.min(
                      bHigh,
                      logLimit /
                        logMagnitude
                    );
                } else {
                  if (
                    isOne(
                      magnitude
                    )
                  ) {
                    possible = false;
                    break;
                  }

                  if (
                    magnitude > 1
                  ) {
                    bLow =
                      Math.max(
                        bLow,
                        logLimit /
                          Math.log(
                            Number(
                              magnitude
                            )
                          )
                      );
                  }
                }

                if (
                  bLow >= bHigh
                ) {
                  possible = false;
                  break;
                }
              }

              if (possible) {
                for (
                  const [repB, b]
                  of BEven
                ) {
                  const key =
                    numericKey(b);

                  if (
                    bLow <= b &&
                    b < bHigh &&
                    !seenB.has(key)
                  ) {
                    seenB.add(key);

                    candidateB.push([
                      repB,
                      b,
                    ]);
                  }
                }
              }
            }

            if (
              candidateB.length ===
              0
            ) {
              continue;
            }

            const inner =
              sym === ""
                ? `${repA}+x`
                : `${repA}-x`;

            for (
              const [repB, b]
              of candidateB
            ) {
              let good = true;

              for (
                let i = 0;
                i < bases.length;
                i++
              ) {
                if (
                  disp(
                    spow(
                      bases[i],
                      b
                    )
                  ) !==
                  xOut[i]
                ) {
                  good = false;
                  break;
                }
              }

              if (good) {
                drop(
                  `(${inner})^${repB}`
                );
              }

              reportProgress(
                token,
                sym
              );
            }
          }
        }
      }

      // a^x%b
      tokenRange =
        token -
        symLen -
        3;

      ok =
        tokenRange >= 2 &&
        (
          zeroIndex === -1 ||
          xOut[zeroIndex] === 1
        ) &&
        (
          domNonnegative ||
          domNonpositive
        );

      if (quick) {
        ok =
          ok &&
          !isDense &&
          zeroRatio < 0.5;
      }

      if (ok) {
        for (
          let t = 1;
          t < tokenRange;
          t++
        ) {
          const bt =
            tokenRange - t;

          if (
            t > 4 ||
            bt > 4
          ) {
            continue;
          }

          const A =
            domNonnegative
              ? genSize(t)
                  .filter(
                    ([, a]) =>
                      a > 1
                  )
              : genSize(t)
                  .filter(
                    ([, a]) =>
                      a < 1
                  );

          const BBase =
            genSize(bt)
              .filter(
                ([, b]) =>
                  b > maxOut
              );

          for (
            const [repA, a]
            of A
          ) {
            const apx =
              sx.map(
                x =>
                  spow(
                    a,
                    x
                  )
              );

            let bMax = Infinity;

            for (
              let i = 0;
              i < apx.length;
              i++
            ) {
              const y =
                apx[i];

              if (
                disp(y) !==
                  xOut[i] &&
                y < bMax
              ) {
                bMax = y;
              }
            }

            for (
              const [repB, b]
              of BBase
            ) {
              if (b > bMax) {
                continue;
              }

              let good = true;

              for (
                let i = 0;
                i < apx.length;
                i++
              ) {
                if (
                  disp(
                    smod(
                      apx[i],
                      b
                    )
                  ) !==
                  xOut[i]
                ) {
                  good = false;
                  break;
                }
              }

              if (good) {
                drop(
                  `${repA}^${sym}x%${repB}`
                );
              }

              reportProgress(
                token,
                sym
              );
            }
          }
        }
      }

      // x/a%b
      const absorbSign =
        sym === "-" ||
        sym === "-~";

      const outputSym =
        absorbSign
          ? sym.slice(1)
          : sym;

      const denominatorSign =
        absorbSign
          ? -1
          : 1;

      tokenRange =
        token -
        outputSym.length -
        3;

      ok =
        tokenRange >= 2;

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
          (
            zeroIndex === -1 ||
            xOut[zeroIndex] === 0
          );
      }

      if (ok) {
        for (
          let t = 1;
          t < tokenRange;
          t++
        ) {
          const bt =
            tokenRange - t;

          if (
            t > 4 ||
            bt > 4
          ) {
            continue;
          }

          let A;

          if (
            denominatorSign === 1
          ) {
            A =
              genSize(t)
                .filter(
                  ([, a]) =>
                    0 < a &&
                    a < 1
                );
          } else {
            A =
              genSizeNeg(t)
                .filter(
                  ([, a]) =>
                    0 <
                      -toFloat(a) &&
                    -toFloat(a) <
                      1
                )
                .map(
                  ([repA, a]) => [
                    repA,
                    sneg(a),
                  ]
                );
          }

          const BBase =
            genSize(bt)
              .filter(
                ([, b]) =>
                  b > maxOut
              );

          for (
            const [repA, a]
            of A
          ) {
            const xda =
              sx.map(
                x =>
                  sdiv(
                    x,
                    a
                  )
              );

            let bMax = Infinity;

            for (
              let i = 0;
              i < xda.length;
              i++
            ) {
              const y =
                xda[i];

              if (
                y >= 0 &&
                disp(y) !==
                  xOut[i] &&
                y < bMax
              ) {
                bMax = y;
              }
            }

            if (
              bMax <= maxOut
            ) {
              continue;
            }

            for (
              const [repB, b]
              of BBase
            ) {
              if (b > bMax) {
                continue;
              }

              let good = true;

              for (
                let i = 0;
                i < xda.length;
                i++
              ) {
                if (
                  disp(
                    smod(
                      xda[i],
                      b
                    )
                  ) !==
                  xOut[i]
                ) {
                  good = false;
                  break;
                }
              }

              if (good) {
                drop(
                  `${outputSym}x/${repA}%${repB}`
                );
              }

              reportProgress(
                token,
                sym
              );
            }
          }
        }
      }

      // f(x/a), f(x*a)
      tokenRange =
        token -
        symLen -
        4;

      ok =
        1 <= tokenRange &&
        tokenRange <= 4;

      if (quick) {
        ok =
          ok &&
          !isDense &&
          zeroRatio >= 0.5;
      }

      if (ok) {
        const A =
          genSize(
            tokenRange
          );

        const onlyZeroOne =
          xOut.every(
            y =>
              y === 0 ||
              y === 1
          );

        for (
          const [symF, f]
          of FUNC_LIST_SCAN
        ) {
          if (
            !onlyZeroOne &&
            (
              symF === "sin" ||
              symF === "cos"
            )
          ) {
            continue;
          }

          for (
            const [repA, a]
            of A
          ) {
            for (
              const mode
              of [0, 1]
            ) {
              const vals = [];
              let valid = true;
              let innerOp;

              if (mode === 0) {
                for (
                  const x
                  of sx
                ) {
                  let v;

                  try {
                    v =
                      f(
                        sdiv(
                          x,
                          a
                        )
                      );
                  } catch {
                    valid = false;
                    break;
                  }

                  if (
                    !Number.isFinite(
                      v
                    )
                  ) {
                    valid = false;
                    break;
                  }

                  vals.push(v);
                }

                innerOp = "/";
              } else {
                for (
                  const x
                  of sx
                ) {
                  let v;

                  try {
                    v =
                      f(
                        smul(
                          x,
                          a
                        )
                      );
                  } catch {
                    valid = false;
                    break;
                  }

                  if (
                    !Number.isFinite(
                      v
                    )
                  ) {
                    valid = false;
                    break;
                  }

                  vals.push(v);
                }

                innerOp = "*";
              }

              if (!valid) {
                continue;
              }

              let good = true;

              for (
                let i = 0;
                i < vals.length;
                i++
              ) {
                if (
                  disp(
                    vals[i]
                  ) !==
                  xOut[i]
                ) {
                  good = false;
                  break;
                }
              }

              if (good) {
                drop(
                  `${symF}(${sym}x${innerOp}${repA})`
                );
              }

              reportProgress(
                token,
                sym
              );
            }
          }
        }
      }

      // f(x)*a, f(x)/a
      tokenRange =
        token - 4;

      ok =
        sym === "" &&
        1 <= tokenRange &&
        tokenRange <= 4;

      if (quick) {
        ok =
          ok &&
          !isDense &&
          zeroRatio >= 0.5;
      }

      if (ok) {
        const A =
          genSize(
            tokenRange
          );

        for (
          const [symF, f]
          of FUNC_LIST_SCAN
        ) {
          const vals = [];
          let valid = true;

          for (
            const x
            of xIn
          ) {
            let v;

            try {
              v = f(x);
            } catch {
              valid = false;
              break;
            }

            if (
              !Number.isFinite(v)
            ) {
              valid = false;
              break;
            }

            vals.push(v);
          }

          if (!valid) {
            continue;
          }

          const first =
            vals[
              coloredIdx[0]
            ];

          if (first === 0) {
            continue;
          }

          const fPos =
            first > 0;

          for (
            const i
            of coloredIdx.slice(1)
          ) {
            const v =
              vals[i];

            if (
              v === 0 ||
              (v > 0) !== fPos
            ) {
              valid = false;
              break;
            }
          }

          if (!valid) {
            continue;
          }

          const absVals =
            coloredIdx.map(
              i =>
                Math.abs(
                  vals[i]
                )
            );

          const divLow =
            Math.max(
              ...absVals
            ) / LIMIT;

          const divHigh =
            Math.min(
              ...absVals
            );

          const mulLow =
            Math.max(
              ...absVals.map(
                v => 1 / v
              )
            );

          const mulHigh =
            Math.min(
              ...absVals.map(
                v => LIMIT / v
              )
            );

          if (
            divLow > divHigh &&
            mulLow > mulHigh
          ) {
            continue;
          }

          const A2 =
            fPos
              ? A
              : genSizeNeg(
                  tokenRange
                );

          for (
            const [repA, a]
            of A2
          ) {
            const a0 =
			  Number(
			    absLua(a)
			  );

            const tryDiv =
              divLow <= a0 &&
              a0 <= divHigh;

            const tryMul =
              mulLow <= a0 &&
              a0 <= mulHigh;

            if (
              !tryDiv &&
              !tryMul
            ) {
              continue;
            }

            if (tryDiv) {
              let good = true;

              for (
                let i = 0;
                i < vals.length;
                i++
              ) {
                if (
                  disp(
                    sdiv(
                      vals[i],
                      a
                    )
                  ) !==
                  xOut[i]
                ) {
                  good = false;
                  break;
                }
              }

              if (good) {
                drop(
                  `${symF}(x)/${repA}`
                );
              }
            }

            if (tryMul) {
              let good = true;

              for (
                let i = 0;
                i < vals.length;
                i++
              ) {
                if (
                  disp(
                    smul(
                      vals[i],
                      a
                    )
                  ) !==
                  xOut[i]
                ) {
                  good = false;
                  break;
                }
              }

              if (good) {
                drop(
                  `${symF}(x)*${repA}`
                );
              }
            }

            reportProgress(
              token,
              sym
            );
          }
        }
      }

      // a>>x&b, a>>x|b, a>>x~b, a<<x&b, a<<x|b, a<<x~b
      tokenRange =
        token -
        symLen -
        3;

      if (
        tokenRange >= 2 &&
        isInt &&
        (
          sym === "" ||
          sym === "~" ||
          sym === "~-"
        )
      ) {
        for (
          let t = 1;
          t < tokenRange;
          t++
        ) {
          const bt =
            tokenRange - t;

          if (
            t > 4 ||
            bt > 4
          ) {
            continue;
          }

          const A =
            genInt(t);

          const B =
            genInt(bt);

          const shiftList = [
            ["<<", lshift],
            [">>", rshift],
          ];

          for (
            const [symOp1, op1]
            of shiftList
          ) {
            for (
              const a
              of A
            ) {
              const asx =
                sx.map(
                  x =>
                    op1(
                      a,
                      x
                    )
                );

              for (
                const [symOp2, op2]
                of BIT_LIST
              ) {
                for (
                  const b
                  of B
                ) {
                  let good = true;

                  for (
                    let i = 0;
                    i < asx.length;
                    i++
                  ) {
                    if (
                      disp(
                        op2(
                          asx[i],
                          b
                        )
                      ) !==
                      xOut[i]
                    ) {
                      good = false;
                      break;
                    }
                  }

                  if (good) {
                    drop(
                      `${a}${symOp1}${sym}x${symOp2}${b}`
                    );
                  }

                  reportProgress(
                    token,
                    sym
                  );
                }
              }
            }
          }
        }
      }

      // f(x/a)/b, f(x/a)*b, f(x*a)/b, f(x*a)*b
      tokenRange =
        token -
        symLen -
        5;

      ok =
        tokenRange >= 2;

      if (quick) {
        ok =
          ok &&
          !isDense &&
          zeroRatio >= 0.5;
      }

      if (ok) {
        for (
          let t = 1;
          t < tokenRange;
          t++
        ) {
          const bt =
            tokenRange - t;

          if (
            t > 4 ||
            bt > 4
          ) {
            continue;
          }

          const A =
            genSize(t);

          const B =
            genSize(bt);

          for (
            const [symF, f]
            of FUNC_LIST_SCAN
          ) {
            for (
              const [repA, a]
              of A
            ) {
              for (
                const mode
                of [0, 1]
              ) {
                const vals = [];
                let modeOk = true;
                let innerOp;

                if (mode === 0) {
                  for (
                    const x
                    of sx
                  ) {
                    let v;

                    try {
                      v =
                        f(
                          sdiv(
                            x,
                            a
                          )
                        );
                    } catch {
                      modeOk = false;
                      break;
                    }

                    if (
                      !Number.isFinite(
                        v
                      )
                    ) {
                      modeOk = false;
                      break;
                    }

                    vals.push(v);
                  }

                  innerOp = "/";
                } else {
                  for (
                    const x
                    of sx
                  ) {
                    let v;

                    try {
                      v =
                        f(
                          smul(
                            x,
                            a
                          )
                        );
                    } catch {
                      modeOk = false;
                      break;
                    }

                    if (
                      !Number.isFinite(
                        v
                      )
                    ) {
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

                const first =
                  vals[
                    coloredIdx[0]
                  ];

                if (first === 0) {
                  continue;
                }

                const fPos =
                  first > 0;

                for (
                  const i
                  of coloredIdx.slice(1)
                ) {
                  const v =
                    vals[i];

                  if (
                    v === 0 ||
                    (v > 0) !== fPos
                  ) {
                    modeOk = false;
                    break;
                  }
                }

                if (!modeOk) {
                  continue;
                }

                const absVals =
                  coloredIdx.map(
                    i =>
                      Math.abs(
                        vals[i]
                      )
                  );

                const divLow =
                  Math.max(
                    ...absVals
                  ) / LIMIT;

                const divHigh =
                  Math.min(
                    ...absVals
                  );

                const mulLow =
                  Math.max(
                    ...absVals.map(
                      v => 1 / v
                    )
                  );

                const mulHigh =
                  Math.min(
                    ...absVals.map(
                      v =>
                        LIMIT / v
                    )
                  );

                if (
                  divLow > divHigh &&
                  mulLow > mulHigh
                ) {
                  continue;
                }

                const B2 =
                  fPos
                    ? B
                    : genSizeNeg(bt);

                for (
                  const [repB, b]
                  of B2
                ) {
                  const b0 =
					Number(
					  absLua(b)
					);

                  const tryDiv =
                    divLow <= b0 &&
                    b0 <= divHigh;

                  const tryMul =
                    mulLow <= b0 &&
                    b0 <= mulHigh;

                  if (
                    !tryDiv &&
                    !tryMul
                  ) {
                    continue;
                  }

                  const inner =
                    innerOp === "/"
                      ? `${sym}x/${repA}`
                      : `${sym}x*${repA}`;

                  if (tryDiv) {
                    let good = true;

                    for (
                      let i = 0;
                      i < vals.length;
                      i++
                    ) {
                      if (
                        disp(
                          sdiv(
                            vals[i],
                            b
                          )
                        ) !==
                        xOut[i]
                      ) {
                        good = false;
                        break;
                      }
                    }

                    if (good) {
                      drop(
                        `${symF}(${inner})/${repB}`
                      );
                    }
                  }

                  if (tryMul) {
                    let good = true;

                    for (
                      let i = 0;
                      i < vals.length;
                      i++
                    ) {
                      if (
                        disp(
                          smul(
                            vals[i],
                            b
                          )
                        ) !==
                        xOut[i]
                      ) {
                        good = false;
                        break;
                      }
                    }

                    if (good) {
                      drop(
                        `${symF}(${inner})*${repB}`
                      );
                    }
                  }

                  reportProgress(
                    token,
                    sym
                  );
                }
              }
            }
          }
        }
      }
    }
  }

  if (foundCount === 0) {
    postMessage({
      type: "not-found",
    });
  }
}

// ------------------------------------------------------------
// Message entry point
// ------------------------------------------------------------

self.addEventListener(
  "message",
  event => {
    const data = event.data;

    if (
      !data ||
      data.type !== "run"
    ) {
      return;
    }

    const payload =
      data.payload || {};

    try {
      const maxToken =
        Number(
          payload.maxToken
        );

      const maxFound =
        Number(
          payload.maxFound ?? 3
        );

      const maxDecimalFractionDigits =
        Number(
          payload
            .maxDecimalFractionDigits ??
            17
        );

      const maxHexFractionDigits =
        Number(
          payload
            .maxHexFractionDigits ??
            17
        );

      const quick =
        Boolean(
          payload.quick
        );

      if (
        !Number.isInteger(
          maxToken
        ) ||
        maxToken < 3
      ) {
        throw new Error(
          "Max token must be an integer greater than or equal to 3."
        );
      }

      if (
        !Number.isInteger(
          maxFound
        ) ||
        maxFound < 1
      ) {
        throw new Error(
          "Max results must be a positive integer."
        );
      }

      if (
        !Number.isInteger(
          maxDecimalFractionDigits
        ) ||
        maxDecimalFractionDigits < 1
      ) {
        throw new Error(
          "Decimal fraction digits must be a positive integer."
        );
      }

      if (
        !Number.isInteger(
          maxHexFractionDigits
        ) ||
        maxHexFractionDigits < 1
      ) {
        throw new Error(
          "Hex fraction digits must be a positive integer."
        );
      }

      configureGenSize({
        maxDecimalFractionDigits,
        maxHexFractionDigits,
      });

      configureGenSizeQuick({
        maxDecimalFractionDigits,
        maxHexFractionDigits,
      });

      try {
        runExpressionScan(
          Array.isArray(
            payload.xIn
          )
            ? payload.xIn
            : [],
          Array.isArray(
            payload.xOut
          )
            ? payload.xOut
            : [],
          maxToken,
          quick,
          maxFound,
        );
      } catch (error) {
        if (
          !(
            error instanceof
            Found
          )
        ) {
          throw error;
        }
      }

      finishRun();
    } catch (error) {
      postMessage({
        type: "error",
        message:
          error &&
          error.stack
            ? String(
                error.stack
              )
            : String(error),
      });
    }
  }
);
