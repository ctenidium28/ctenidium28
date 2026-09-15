"use strict";

// ------------------------------------------------------------
// DOM references
// ------------------------------------------------------------

const pairsBody = document.getElementById("pairsBody");
const addRowButton = document.getElementById("addRowButton");
const addNextRowButton = document.getElementById("addNextRowButton");
const allClearButton = document.getElementById("allClearButton");
const runButton = document.getElementById("runButton");
const stopButton = document.getElementById("stopButton");

const maxTokenInput = document.getElementById("maxTokenInput");
const maxFoundInput = document.getElementById("maxFoundInput");
const maxDecimalFractionDigitsInput = document.getElementById(
  "maxDecimalFractionDigitsInput"
);
const maxHexFractionDigitsInput = document.getElementById(
  "maxHexFractionDigitsInput"
);

const expressionFamilyScanInput = document.getElementById(
  "expressionFamilyScanInput"
);
const symbolicRegressionInput = document.getElementById(
  "symbolicRegressionInput"
);
const scanModeOptions = document.getElementById("scanModeOptions");
const symbolicRegressionOptions = document.getElementById(
  "symbolicRegressionOptions"
);
const stateLimitInput = document.getElementById("stateLimitInput");

const resultOutput = document.getElementById("resultOutput");
const copyResultButton = document.getElementById("copyResultButton");

let activeWorker = null;
let foundExpressions = [];
let scanWarnings = [];
let currentProgress = null;
let notFound = false;


// ------------------------------------------------------------
// Input rows
// ------------------------------------------------------------

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


function addNextRow() {
  const rows = Array.from(pairsBody.querySelectorAll("tr"));

  if (rows.length === 0) {
    addRow(0, 0);
    return;
  }

  const lastRow = rows[rows.length - 1];
  const lastXInput = lastRow.querySelector(".x-in-input");
  const lastX = Number(lastXInput.value);

  if (!Number.isFinite(lastX)) {
    addRow(0, 0);
    return;
  }

  addRow(lastX + 1, 0);
}


function clearAllRows() {
  pairsBody.replaceChildren();
}


function readPairs() {
  const rows = Array.from(pairsBody.querySelectorAll("tr"));

  if (rows.length === 0) {
    throw new Error("Please enter at least one input pair.");
  }

  const xIn = [];
  const xOut = [];

  for (const row of rows) {
    const xiText = row.querySelector(".x-in-input").value.trim();
    const xoText = row.querySelector(".x-out-input").value.trim();

    if (xiText === "" || !Number.isFinite(Number(xiText))) {
      throw new Error("x_in must contain finite numbers.");
    }

    const xo = Number(xoText);

    if (!Number.isFinite(xo)) {
      throw new Error("x_out must contain finite numbers.");
    }

    // x_inは表記を保持したままWorkerへ送る。
    // これにより1と1.0などのLua subtypeを区別できる。
    xIn.push(xiText);
    xOut.push(xo);
  }

  return { xIn, xOut };
}


// ------------------------------------------------------------
// Options
// ------------------------------------------------------------

function readQuickMode() {
  const selected = document.querySelector(
    'input[name="scanMode"]:checked'
  );

  return selected !== null && selected.value === "quick";
}


function readOptions() {
  const maxToken = Number(maxTokenInput.value);
  const maxFound = Number(maxFoundInput.value);
  const maxDecimalFractionDigits = Number(
    maxDecimalFractionDigitsInput.value
  );
  const maxHexFractionDigits = Number(
    maxHexFractionDigitsInput.value
  );

  const expressionFamilyScan = expressionFamilyScanInput.checked;
  const symbolicRegression = symbolicRegressionInput.checked;

  if (!expressionFamilyScan && !symbolicRegression) {
    throw new Error(
      "Enable at least one search method."
    );
  }

  if (!Number.isInteger(maxToken) || maxToken < 2) {
    throw new Error(
      "Max token must be an integer greater than or equal to 2."
    );
  }

  if (!Number.isInteger(maxFound) || maxFound < 1) {
    throw new Error(
      "Max results must be a positive integer."
    );
  }

  if (
    !Number.isInteger(maxDecimalFractionDigits) ||
    maxDecimalFractionDigits < 1
  ) {
    throw new Error(
      "Decimal fraction digits must be a positive integer."
    );
  }

  if (
    !Number.isInteger(maxHexFractionDigits) ||
    maxHexFractionDigits < 1
  ) {
    throw new Error(
      "Hex fraction digits must be a positive integer."
    );
  }

  let stateLimit = null;

  if (symbolicRegression) {
    stateLimit = Number(stateLimitInput.value);

    if (
      !Number.isSafeInteger(stateLimit) ||
      stateLimit < 1
    ) {
      throw new Error(
        "State limit per layer must be a positive integer."
      );
    }
  }

  return {
    maxToken,
    maxFound,
    maxDecimalFractionDigits,
    maxHexFractionDigits,
    expressionFamilyScan,
    symbolicRegression,
    quick:
      expressionFamilyScan
        ? readQuickMode()
        : false,
    stateLimit,
  };
}


// ------------------------------------------------------------
// UI state
// ------------------------------------------------------------

function syncMethodOptionState(scanning = false) {
  expressionFamilyScanInput.disabled = scanning;
  symbolicRegressionInput.disabled = scanning;

  scanModeOptions.disabled =
    scanning ||
    !expressionFamilyScanInput.checked;

  symbolicRegressionOptions.disabled =
    scanning ||
    !symbolicRegressionInput.checked;
}


function setScanningState(scanning) {
  runButton.disabled = scanning;
  addRowButton.disabled = scanning;

  maxTokenInput.disabled = scanning;
  maxFoundInput.disabled = scanning;
  maxDecimalFractionDigitsInput.disabled = scanning;
  maxHexFractionDigitsInput.disabled = scanning;

  if (addNextRowButton) {
    addNextRowButton.disabled = scanning;
  }

  if (allClearButton) {
    allClearButton.disabled = scanning;
  }

  if (stopButton) {
    stopButton.disabled = !scanning;
  }

  syncMethodOptionState(scanning);
}


function disposeWorker() {
  if (activeWorker !== null) {
    activeWorker.terminate();
    activeWorker = null;
  }
}


function formatProgressMessage(data) {
  const tokenPart = `token=${data.token}`;

  if (
    data.symbol === null ||
    data.symbol === undefined
  ) {
    return `Scanning... ${tokenPart}`;
  }

  const symbol =
    data.symbol === ""
      ? "x"
      : data.symbol;

  return (
    `Scanning... ${tokenPart}, ` +
    `symbol="${symbol}", checks=${data.checks}`
  );
}


function renderOutput() {
  const lines = [];

  if (foundExpressions.length > 0) {
    lines.push(...foundExpressions);
  }

  if (scanWarnings.length > 0) {
    if (lines.length > 0) {
      lines.push("");
    }

    lines.push(...scanWarnings);
  }

  if (notFound && foundExpressions.length === 0) {
    if (lines.length > 0) {
      lines.push("");
    }

    lines.push("Not Found");
  }

  if (currentProgress !== null) {
    if (lines.length > 0) {
      lines.push("");
    }

    lines.push(currentProgress);
  }

  if (lines.length === 0) {
    resultOutput.textContent = "Ready.";
    return;
  }

  resultOutput.textContent = lines.join("\n");
}


// ------------------------------------------------------------
// Worker control
// ------------------------------------------------------------

function startScan(xIn, xOut, options) {
  disposeWorker();

  const worker = new Worker("./scan_worker.js");
  activeWorker = worker;

  foundExpressions = [];
  scanWarnings = [];
  currentProgress = "Scanning...";
  notFound = false;

  setScanningState(true);
  renderOutput();

  worker.addEventListener("message", event => {
    if (activeWorker !== worker) {
      return;
    }

    const data = event.data || {};

    if (data.type === "progress") {
      currentProgress =
        formatProgressMessage(data);

      renderOutput();
      return;
    }

    if (data.type === "result") {
      foundExpressions.push(
        String(data.expression)
      );

      renderOutput();
      return;
    }

    if (data.type === "warning") {
      scanWarnings.push(
        String(
          data.message ||
          "Scan warning."
        )
      );

      renderOutput();
      return;
    }

    if (data.type === "not-found") {
      notFound = true;
      currentProgress = null;

      renderOutput();
      return;
    }

    if (data.type === "done") {
      currentProgress = null;

      renderOutput();
      disposeWorker();
      setScanningState(false);
      return;
    }

    if (data.type === "error") {
      currentProgress = null;

      resultOutput.textContent =
        String(
          data.message ||
          "Worker error."
        );

      disposeWorker();
      setScanningState(false);
    }
  });

  worker.addEventListener("error", event => {
    if (activeWorker !== worker) {
      return;
    }

    const message =
      event.message ||
      "Worker error.";

    currentProgress = null;
    resultOutput.textContent =
      String(message);

    disposeWorker();
    setScanningState(false);
  });

  worker.postMessage({
    type: "run",
    payload: {
      xIn,
      xOut,

      maxToken: options.maxToken,
      maxFound: options.maxFound,

      maxDecimalFractionDigits:
        options.maxDecimalFractionDigits,

      maxHexFractionDigits:
        options.maxHexFractionDigits,

      expressionFamilyScan:
        options.expressionFamilyScan,

      symbolicRegression:
        options.symbolicRegression,

      quick:
        options.quick,

      stateLimit:
        options.stateLimit,
    },
  });
}


// ------------------------------------------------------------
// Events
// ------------------------------------------------------------

addRowButton.addEventListener("click", () => {
  addRow(0, 0);
});


if (addNextRowButton) {
  addNextRowButton.addEventListener(
    "click",
    addNextRow
  );
}


if (allClearButton) {
  allClearButton.addEventListener(
    "click",
    clearAllRows
  );
}


expressionFamilyScanInput.addEventListener(
  "change",
  () => {
    syncMethodOptionState(false);
  }
);


symbolicRegressionInput.addEventListener(
  "change",
  () => {
    syncMethodOptionState(false);
  }
);


if (stopButton) {
  stopButton.addEventListener("click", () => {
    if (activeWorker === null) {
      return;
    }

    disposeWorker();
    currentProgress = null;

    if (foundExpressions.length > 0) {
      const lines = [
        ...foundExpressions,
      ];

      if (scanWarnings.length > 0) {
        lines.push(
          "",
          ...scanWarnings
        );
      }

      lines.push("", "Stopped.");

      resultOutput.textContent =
        lines.join("\n");
    } else {
      const lines = [];

      if (scanWarnings.length > 0) {
        lines.push(
          ...scanWarnings,
          ""
        );
      }

      lines.push("Stopped.");

      resultOutput.textContent =
        lines.join("\n");
    }

    setScanningState(false);
  });
}


if (copyResultButton) {
  copyResultButton.addEventListener(
    "click",
    async () => {
      const text =
        resultOutput.textContent;

      try {
        await navigator.clipboard.writeText(
          text
        );

        copyResultButton.textContent =
          "Copied";

        setTimeout(() => {
          copyResultButton.textContent =
            "Copy";
        }, 1000);

      } catch {
        copyResultButton.textContent =
          "Failed";

        setTimeout(() => {
          copyResultButton.textContent =
            "Copy";
        }, 1000);
      }
    }
  );
}


runButton.addEventListener("click", () => {
  try {
    const { xIn, xOut } =
      readPairs();

    const options =
      readOptions();

    startScan(
      xIn,
      xOut,
      options
    );

  } catch (error) {
    resultOutput.textContent =
      error && error.stack
        ? String(error.stack)
        : String(error);
  }
});


// ------------------------------------------------------------
// Initial UI state
// ------------------------------------------------------------

syncMethodOptionState(false);


// ------------------------------------------------------------
// Default sample
// ------------------------------------------------------------

addRow(-1, 10);
addRow(0, 9);
addRow(1, 7);
