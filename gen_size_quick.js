"use strict";

(() => {
  // ------------------------------------------------------------
  // Parameters
  // ------------------------------------------------------------

  const MAX_SCAN_SIZE_QUICK = 4;
  let MAX_DECIMAL_FRACTION_DIGITS_QUICK = 17;
  let MAX_HEX_FRACTION_DIGITS_QUICK = 17;


  // ------------------------------------------------------------
  // Integer component token cost
  // ------------------------------------------------------------

  function is2powQuick(n) {
    return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
  }


  function bitLengthQuick(n) {
    if (n <= 0) {
      return 0;
    }
    return Math.floor(Math.log2(n)) + 1;
  }


  function size2intQuick(size) {
    return size > 0 ? (2 ** (4 * bitLengthQuick(size))) + 1 : 1;
  }


  const COMPONENT_VALUES_QUICK_CACHE = new Map();

  function componentValuesQuick(size) {
    if (COMPONENT_VALUES_QUICK_CACHE.has(size)) {
      return COMPONENT_VALUES_QUICK_CACHE.get(size);
    }

    if (!is2powQuick(size)) {
      const out = Object.freeze([]);
      COMPONENT_VALUES_QUICK_CACHE.set(size, out);
      return out;
    }

    const upper = size2intQuick(size);
    const lower = size === 1 ? 0 : size2intQuick(size / 2);
    const out = [];

    for (let n = lower; n < upper; n++) {
      out.push(n);
    }

    Object.freeze(out);
    COMPONENT_VALUES_QUICK_CACHE.set(size, out);
    return out;
  }


  // ------------------------------------------------------------
  // Candidate insertion
  // ------------------------------------------------------------

  function betterTextQuick(newText, oldText) {
    return (
      newText.length < oldText.length ||
      (newText.length === oldText.length && newText < oldText)
    );
  }


  function quickValueKey(value) {
    if (typeof value === "bigint") {
      return `n:${Number(value)}`;
    }

    if (typeof value === "number") {
      return `n:${value}`;
    }

    throw new TypeError(
      `unsupported quick literal value: ${String(value)}`
    );
  }


  function addQuick(out, seen, text, value) {
    const numeric =
      typeof value === "bigint"
        ? Number(value)
        : value;

    if (!(numeric > 0)) {
      return;
    }

    const key = quickValueKey(value);

    if (seen.has(key)) {
      return;
    }

    const old = out.get(key);

    if (
      old === undefined ||
      betterTextQuick(text, old[0])
    ) {
      out.set(key, [text, value]);
    }
  }


  // ------------------------------------------------------------
  // Decimal fixed notation
  // ------------------------------------------------------------

  function generateDecimalFixedQuick(out, seen, tokenSize) {
    // integer
    for (const n of componentValuesQuick(tokenSize)) {
      if (n !== 0) {
        addQuick(
          out,
          seen,
          String(n),
          BigInt(n)
        );
      }
    }

    // .fraction
    for (const q of componentValuesQuick(tokenSize)) {
      if (q === 0 || q % 10 === 0) {
        continue;
      }

      const digits = String(q);
      const maxZero =
        MAX_DECIMAL_FRACTION_DIGITS_QUICK -
        digits.length;

      for (let z = 0; z <= maxZero; z++) {
        const text =
          "." +
          "0".repeat(z) +
          digits;

        const value = Number(text);

        if (value === 0) {
          break;
        }

        addQuick(
          out,
          seen,
          text,
          value
        );
      }
    }

    // integer.fraction
    for (
      let leftSize = 1;
      leftSize < tokenSize;
      leftSize++
    ) {
      const rightSize =
        tokenSize - leftSize;

      if (
        !is2powQuick(leftSize) ||
        !is2powQuick(rightSize)
      ) {
        continue;
      }

      for (
        const p of
        componentValuesQuick(leftSize)
      ) {
        if (p === 0) {
          continue;
        }

        const base = Number(p);

        for (
          const q of
          componentValuesQuick(rightSize)
        ) {
          if (
            q === 0 ||
            q % 10 === 0
          ) {
            continue;
          }

          const digits = String(q);
          let z = 0;

          while (true) {
            const text =
              `${p}.` +
              "0".repeat(z) +
              digits;

            const value = Number(text);

            // これ以降はfractionがbinary64上で消える。
            if (value === base) {
              break;
            }

            addQuick(
              out,
              seen,
              text,
              value
            );

            z++;
          }
        }
      }
    }
  }


  // ------------------------------------------------------------
  // Hex fixed notation (Quick 1..2 token only)
  // ------------------------------------------------------------

  function* iterHexFractionTextsQuick(q) {
    if (
      q === 0 ||
      q % 16 === 0
    ) {
      return;
    }

    const digits =
      q
        .toString(16)
        .toUpperCase();

    const maxZero =
      MAX_HEX_FRACTION_DIGITS_QUICK -
      digits.length;

    for (
      let z = 0;
      z <= maxZero;
      z++
    ) {
      yield (
        "0".repeat(z) +
        digits
      );
    }
  }


  function generateHexFixedQuick(
    out,
    seen,
    tokenSize
  ) {
    // Hex integerも生成するが、
    // 通常はdecimal integerとの数値重複で消える。
    for (
      const n of
      componentValuesQuick(tokenSize)
    ) {
      if (n !== 0) {
        addQuick(
          out,
          seen,
          `0x${n
            .toString(16)
            .toUpperCase()}`,
          BigInt(n)
        );
      }
    }

    // 0x.fraction
    const rightSize =
      tokenSize - 1;

    if (is2powQuick(rightSize)) {
      for (
        const q of
        componentValuesQuick(rightSize)
      ) {
        if (q === 0) {
          continue;
        }

        for (
          const frac of
          iterHexFractionTextsQuick(q)
        ) {
          const text =
            `0x.${frac}`;

          const value =
            luaLiteralValue(text);

          if (value === 0) {
            break;
          }

          addQuick(
            out,
            seen,
            text,
            value
          );
        }
      }
    }

    // 0xINT.FRACTION
    for (
      let leftSize = 1;
      leftSize < tokenSize;
      leftSize++
    ) {
      const rightSize2 =
        tokenSize - leftSize;

      if (
        !is2powQuick(leftSize) ||
        !is2powQuick(rightSize2)
      ) {
        continue;
      }

      for (
        const p of
        componentValuesQuick(leftSize)
      ) {
        if (p === 0) {
          continue;
        }

        const left =
          p
            .toString(16)
            .toUpperCase();

        const base = Number(p);

        for (
          const q of
          componentValuesQuick(rightSize2)
        ) {
          if (q === 0) {
            continue;
          }

          for (
            const frac of
            iterHexFractionTextsQuick(q)
          ) {
            const text =
              `0x${left}.${frac}`;

            const value =
              luaLiteralValue(text);

            // これ以降はfractionがbinary64上で消える。
            if (value === base) {
              break;
            }

            addQuick(
              out,
              seen,
              text,
              value
            );
          }
        }
      }
    }
  }


  // ------------------------------------------------------------
  // Public gen_size
  // ------------------------------------------------------------

  const GEN_SIZE_QUICK_CACHE =
    new Map();

  function genSizeQuickCached(
    tokenSize
  ) {
    if (
      GEN_SIZE_QUICK_CACHE.has(
        tokenSize
      )
    ) {
      return (
        GEN_SIZE_QUICK_CACHE.get(
          tokenSize
        )
      );
    }

    if (tokenSize < 1) {
      return [];
    }

    if (
      tokenSize >
      MAX_SCAN_SIZE_QUICK
    ) {
      throw new RangeError(
        `gen_size_quick only supports sizes ` +
        `1..${MAX_SCAN_SIZE_QUICK}; ` +
        `got ${tokenSize}`
      );
    }

    // Hybrid全体としてexact shellにする。
    // 3 token以降がQ0でも、
    // 1..2 tokenのQ1で既出の値は除外する。
    const seen = new Set();

    for (
      let smaller = 1;
      smaller < tokenSize;
      smaller++
    ) {
      for (
        const [, value] of
        genSizeQuickCached(smaller)
      ) {
        seen.add(
          quickValueKey(value)
        );
      }
    }

    const out = new Map();

    // Q0:
    // integer + decimal fixed
    generateDecimalFixedQuick(
      out,
      seen,
      tokenSize
    );

    // Q1:
    // Q0 + hex fixed
    // Hybridでは1..2 tokenだけQ1を使う。
    if (tokenSize <= 2) {
      generateHexFixedQuick(
        out,
        seen,
        tokenSize
      );
    }

    // 速度優先のためソートしない。
    const result =
      Array.from(out.values());

    Object.freeze(result);

    GEN_SIZE_QUICK_CACHE.set(
      tokenSize,
      result
    );

    return result;
  }


  function gen_size_quick(
    tokenSize
  ) {
    return (
      genSizeQuickCached(
        tokenSize
      )
    );
  }


  // ------------------------------------------------------------
  // Integer-only shell
  // ------------------------------------------------------------

  const GEN_INT_QUICK_CACHE =
    new Map();

  function gen_int_quick(
    tokenSize
  ) {
    if (
      GEN_INT_QUICK_CACHE.has(
        tokenSize
      )
    ) {
      return (
        GEN_INT_QUICK_CACHE.get(
          tokenSize
        )
      );
    }

    if (
      !is2powQuick(tokenSize)
    ) {
      const out =
        Object.freeze([]);

      GEN_INT_QUICK_CACHE.set(
        tokenSize,
        out
      );

      return out;
    }

    const upper =
      size2intQuick(tokenSize);

    const out = [];

    if (tokenSize === 1) {
      for (
        let x = 1 - upper;
        x < upper;
        x++
      ) {
        out.push(BigInt(x));
      }
    } else {
      const lower =
        size2intQuick(
          tokenSize / 2
        );

      for (
        let x = 1 - upper;
        x < 1 - lower;
        x++
      ) {
        out.push(BigInt(x));
      }

      for (
        let x = lower;
        x < upper;
        x++
      ) {
        out.push(BigInt(x));
      }
    }

    Object.freeze(out);

    GEN_INT_QUICK_CACHE.set(
      tokenSize,
      out
    );

    return out;
  }


  // ------------------------------------------------------------
  // Configuration / cache
  // ------------------------------------------------------------

  function clearGenSizeQuickCaches() {
    COMPONENT_VALUES_QUICK_CACHE.clear();
    GEN_SIZE_QUICK_CACHE.clear();
    GEN_INT_QUICK_CACHE.clear();
  }


  function configureGenSizeQuick({
    maxDecimalFractionDigits =
      MAX_DECIMAL_FRACTION_DIGITS_QUICK,

    maxHexFractionDigits =
      MAX_HEX_FRACTION_DIGITS_QUICK,
  } = {}) {
    if (
      !Number.isInteger(
        maxDecimalFractionDigits
      ) ||
      maxDecimalFractionDigits < 1
    ) {
      throw new RangeError(
        "maxDecimalFractionDigits must be a positive integer"
      );
    }

    if (
      !Number.isInteger(
        maxHexFractionDigits
      ) ||
      maxHexFractionDigits < 1
    ) {
      throw new RangeError(
        "maxHexFractionDigits must be a positive integer"
      );
    }

    if (
      maxDecimalFractionDigits ===
        MAX_DECIMAL_FRACTION_DIGITS_QUICK &&
      maxHexFractionDigits ===
        MAX_HEX_FRACTION_DIGITS_QUICK
    ) {
      return;
    }

    MAX_DECIMAL_FRACTION_DIGITS_QUICK =
      maxDecimalFractionDigits;

    MAX_HEX_FRACTION_DIGITS_QUICK =
      maxHexFractionDigits;

    clearGenSizeQuickCaches();

    globalThis
      .MAX_DECIMAL_FRACTION_DIGITS_QUICK =
      MAX_DECIMAL_FRACTION_DIGITS_QUICK;

    globalThis
      .MAX_HEX_FRACTION_DIGITS_QUICK =
      MAX_HEX_FRACTION_DIGITS_QUICK;
  }


  // ------------------------------------------------------------
  // Browser / Web Worker globals
  // ------------------------------------------------------------

  Object.assign(
    globalThis,
    {
      MAX_SCAN_SIZE_QUICK,

      MAX_DECIMAL_FRACTION_DIGITS_QUICK,
      MAX_HEX_FRACTION_DIGITS_QUICK,

      gen_size_quick,
      gen_int_quick,

      configureGenSizeQuick,
      clearGenSizeQuickCaches,
    }
  );
})();
