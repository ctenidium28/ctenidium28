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
const resultOutput = document.getElementById("resultOutput");
const copyResultButton = document.getElementById("copyResultButton");

let activeWorker = null;

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

function readQuickMode() {
  const selected = document.querySelector(
    'input[name="scanMode"]:checked',
  );

  // index.html更新前でもPython最新版の quick=false と一致させる。
  return selected !== null && selected.value === "quick";
}

// ------------------------------------------------------------
// UI state
// ------------------------------------------------------------

function setScanningState(scanning) {
  runButton.disabled = scanning;
  addRowButton.disabled = scanning;
  maxTokenInput.disabled = scanning;

  if (addNextRowButton) {
    addNextRowButton.disabled = scanning;
  }

  if (allClearButton) {
    allClearButton.disabled = scanning;
  }

  if (stopButton) {
    stopButton.disabled = !scanning;
  }

  const modeInputs = document.querySelectorAll(
    'input[name="scanMode"]',
  );

  for (const input of modeInputs) {
    input.disabled = scanning;
  }
}

function disposeWorker() {
  if (activeWorker !== null) {
    activeWorker.terminate();
    activeWorker = null;
  }
}

function formatProgressMessage(data) {
  const tokenPart = `token=${data.token}`;

  if (data.symbol === null || data.symbol === undefined) {
    return `Scanning... ${tokenPart}`;
  }

  const symbol = data.symbol === "" ? "x" : data.symbol;
  return (
    `Scanning... ${tokenPart}, ` +
    `symbol="${symbol}", checks=${data.checks}`
  );
}

// ------------------------------------------------------------
// Worker control
// ------------------------------------------------------------

function startScan(xIn, xOut, maxToken, quick) {
  disposeWorker();

  const worker = new Worker("./scan_worker.js");
  activeWorker = worker;

  setScanningState(true);
  resultOutput.textContent = "Scanning...";

  worker.addEventListener("message", event => {
    if (activeWorker !== worker) {
      return;
    }

    const data = event.data || {};

    if (data.type === "progress") {
      resultOutput.textContent = formatProgressMessage(data);
      return;
    }

    if (data.type === "result") {
      resultOutput.textContent = String(data.expression);
      disposeWorker();
      setScanningState(false);
      return;
    }

    if (data.type === "not-found") {
      resultOutput.textContent = "Not Found";
      disposeWorker();
      setScanningState(false);
      return;
    }

    if (data.type === "error") {
      resultOutput.textContent = String(data.message || "Worker error.");
      disposeWorker();
      setScanningState(false);
    }
  });

  worker.addEventListener("error", event => {
    if (activeWorker !== worker) {
      return;
    }

    const message = event.message || "Worker error.";
    resultOutput.textContent = String(message);

    disposeWorker();
    setScanningState(false);
  });

  worker.postMessage({
    type: "run",
    payload: {
      xIn,
      xOut,
      maxToken,
      quick,
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
  addNextRowButton.addEventListener("click", addNextRow);
}

if (allClearButton) {
  allClearButton.addEventListener("click", clearAllRows);
}

if (stopButton) {
  stopButton.addEventListener("click", () => {
    if (activeWorker === null) {
      return;
    }

    disposeWorker();
    resultOutput.textContent = "Stopped.";
    setScanningState(false);
  });
}

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

runButton.addEventListener("click", () => {
  try {
    const { xIn, xOut } = readPairs();
    const maxToken = Number(maxTokenInput.value);

    if (!Number.isInteger(maxToken) || maxToken < 3) {
      throw new Error(
        "Max token must be an integer greater than or equal to 3.",
      );
    }

    const quick = readQuickMode();
    startScan(xIn, xOut, maxToken, quick);
  } catch (error) {
    resultOutput.textContent =
      error && error.stack
        ? String(error.stack)
        : String(error);
  }
});

// ------------------------------------------------------------
// Default sample
// ------------------------------------------------------------

addRow(-1, 10);
addRow(0, 9);
addRow(1, 7);
