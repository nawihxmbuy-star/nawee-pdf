bottomSheet.classList.remove("active");
}

function changeActiveNodeSize(amount) {
  if (activeDraggableNode) {
    let currentSize = parseInt(activeDraggableNode.style.fontSize) || 24;
    let newSize = currentSize + amount;
    if (newSize >= 12 && newSize <= 100) {
      activeDraggableNode.style.fontSize = newSize + "px";
      const textSizeSlider = document.getElementById("text-size-slider");
      const textSizeLabel = document.getElementById("text-size-val");
      if (textSizeSlider && textSizeLabel) {
        textSizeSlider.value = newSize;
        textSizeLabel.innerText = newSize + "px";
      }
    }
  }
}
function deleteActiveTextNode() {
  if (activeDraggableNode) {
    activeDraggableNode.remove();
    activeDraggableNode = null;
    closeTextSheet();
  }
}
function deselectTextNode() {
  clearActiveDraggableNode();
  closeTextSheet();
}

document.addEventListener("DOMContentLoaded", () => {
  container = document.getElementById("pdf-container");
  workspace = document.querySelector(".workspace");
  appTitle = document.getElementById("app-title");

  const uploadInput = document.getElementById("upload");
  if (uploadInput) uploadInput.addEventListener("change", handleFileOpen);

  const colorPicker = document.getElementById("color-picker");
  if (colorPicker) {
    colorPicker.addEventListener("input", (e) => {
      currentActiveColor = e.target.value;
      // เคลียร์สถานะ active ของจานสีสำเร็จรูปถ้าผู้ใช้เจาะจงเลือกสีเองพิสดาร
      document
        .querySelectorAll(".pen-palette-dot")
        .forEach((d) => d.classList.remove("active"));
      updateBrushPreview();
    });
  }

  const brushSlider = document.getElementById("brush-size-slider");
  const brushLabel = document.getElementById("brush-size-val");
  if (brushSlider && brushLabel) {
    brushSlider.addEventListener("input", (e) => {
      currentBrushSize = parseInt(e.target.value);
      brushLabel.innerText = currentBrushSize + "px";
      updateBrushPreview();
    });
  }

  const textColorPicker = document.getElementById("text-color-picker");
  if (textColorPicker) {
    textColorPicker.addEventListener("input", (e) => {
      currentTextActiveColor = e.target.value;
      document
        .querySelectorAll(".text-palette-dot")
        .forEach((d) => d.classList.remove("active"));
      if (activeDraggableNode) {
        activeDraggableNode.style.color = currentTextActiveColor;
        activeDraggableNode.style.borderColor = currentTextActiveColor;
        const floatingTextColor = document.getElementById(
          "floating-text-color"
        );
        if (floatingTextColor) floatingTextColor.value = currentTextActiveColor;
      }
    });
  }

  const textSizeSlider = document.getElementById("text-size-slider");
  const textSizeLabel = document.getElementById("text-size-val");
  if (textSizeSlider && textSizeLabel) {
    textSizeSlider.addEventListener("input", (e) => {
      currentTextSize = parseInt(e.target.value);
      textSizeLabel.innerText = currentTextSize + "px";
      if (activeDraggableNode) {
        activeDraggableNode.style.fontSize = currentTextSize + "px";
      }
    });
  }

  const floatingTextColor = document.getElementById("floating-text-color");
  if (floatingTextColor) {
    floatingTextColor.addEventListener("input", (e) => {
      currentTextActiveColor = e.target.value;
      document
        .querySelectorAll(".text-palette-dot")
        .forEach((d) => d.classList.remove("active"));
      if (activeDraggableNode) {
        activeDraggableNode.style.color = currentTextActiveColor;
        activeDraggableNode.style.borderColor = currentTextActiveColor;
        const textColorPicker = document.getElementById("text-color-picker");
        if (textColorPicker) textColorPicker.value = currentTextActiveColor;
      }
    });
  }
    await html2pdf().set(getPDFOptions()).from(element).save();
  } catch (e) {
    alert("เกิดข้อผิดพลาดในการดาวน์โหลดค่ะ");
  } finally {
    styleTag.remove();
    if (element) {
      element.style.transform = originalTransform;
      element.style.transformOrigin = originalTransformOrigin;
    }
    if (workspace) {
      workspace.scrollTop = originalScrollTop;
      workspace.scrollLeft = originalScrollLeft;
    }
    currentScale = originalScale;
    applyZoom();
  }
}

    preview.style.height = currentBrushSize + "px";
    preview.style.backgroundColor = currentActiveColor;
  }
}

async function handleFileOpen(e) {
  try {
    const file = e.target.files[0];
    if (!file) return;
    originalFileName = file.name.replace(/\.[^/.]+$/, "");
    const arrayBuffer = await file.arrayBuffer();
    pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    container.innerHTML = "";
    currentScale = 1.0;
    applyZoom();

    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: 2.5 });

      const pageWrapper = document.createElement("div");
      pageWrapper.className = "page-wrapper";
      pageWrapper.style.width = viewport.width / 2 + "px";
      pageWrapper.style.height = viewport.height / 2 + "px";

      const pdfCanvas = document.createElement("canvas");
      pdfCanvas.className = "pdf-page-canvas";
      pdfCanvas.width = viewport.width;
      pdfCanvas.height = viewport.height;
      pageWrapper.appendChild(pdfCanvas);

      const drawingCanvas = document.createElement("canvas");
      drawingCanvas.className = "drawing-page-canvas";
      drawingCanvas.width = viewport.width;
      drawingCanvas.height = viewport.height;
      pageWrapper.appendChild(drawingCanvas);

      const textOverlayLayer = document.createElement("div");
      textOverlayLayer.className = "text-overlay-layer";
      pageWrapper.appendChild(textOverlayLayer);
      container.appendChild(pageWrapper);

      await page.render({
        canvasContext: pdfCanvas.getContext("2d"),
        viewport: viewport,
      }).promise;

      const displayViewport = page.getViewport({ scale: 1.25 });
      const textContent = await page.getTextContent();

      textContent.items.forEach((item) => {
        if (!item.str || item.str.trim() === "") return;
        const [left, txY] = displayViewport.convertToViewportPoint(
          item.transform[4],
          item.transform[5]
        );
        const fontHeight = Math.abs(item.transform[3]) * 1.25;
        const top = txY - fontHeight;

        const textNode = document.createElement("div");
        textNode.className = "word-text-node";
        textNode.setAttribute("contenteditable", "false");
        textNode.style.left = left + "px";
        textNode.style.top = top + "px";
        textNode.style.fontSize = fontHeight + "px";

        const calculatedWidth = item.width * 1.25;
        if (calculatedWidth > 0) textNode.style.width = calculatedWidth + "px";
        textNode.innerText = item.str;
        textNode.addEventListener("input", () =>
          textNode.classList.add("is-edited")
        );
        textOverlayLayer.appendChild(textNode);
      });
      bindDrawingEngine(drawingCanvas);
    }
    switchFileMode(currentFileMode);
  } catch (error) {
    alert("เกิดข้อผิดพลาดในการโหลดชีทสเปซ: " + error.message);
  }
}
function bindDrawingEngine(canvas) {
  const ctx = canvas.getContext("2d");
  let isDrawing = false;
  let lastX = 0,
    lastY = 0;

  if (!canvas.undoStack) {
    canvas.undoStack = [canvas.toDataURL()];
    canvas.redoStack = [];
  }

  function getCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
    };
  }
  function startAction(e) {
    if (
      currentTool === "pan" ||
      currentTool === "text" ||
      (e.touches && e.touches.length > 1)
    )
      return;
    const coords = getCoords(e);
    isDrawing = true;
    lastX = coords.x;
    lastY = coords.y;
  }
  function moveAction(e) {
    if (
      !isDrawing ||
      currentTool === "pan" ||
      currentTool === "text" ||
      (e.touches && e.touches.length > 1)
    )
      return;
    const coords = getCoords(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(coords.x, coords.y);

    if (currentTool === "pen") {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = currentActiveColor;
      ctx.lineWidth = currentBrushSize * 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    } else if (currentTool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = currentBrushSize * 12;
      ctx.lineCap = eraserShape === "square" ? "square" : "round";
      ctx.lineJoin = eraserShape === "square" ? "miter" : "round";
      ctx.stroke();
    }
    lastX = coords.x;
    lastY = coords.y;
  }
  const stopAction = () => {
    if (isDrawing) {
      isDrawing = false;
      const currentState = canvas.toDataURL();
      if (canvas.undoStack[canvas.undoStack.length - 1] !== currentState) {
        canvas.undoStack.push(currentState);
        canvas.redoStack = [];
      }
    }
  };
  canvas.addEventListener("mousedown", startAction);
  canvas.addEventListener("mousemove", moveAction);
  canvas.addEventListener("mouseup", stopAction);
  canvas.addEventListener("mouseleave", stopAction);
  canvas.addEventListener(
    "touchstart",
    (ev) => {
      if (
        ev.touches.length === 1 &&
        currentTool !== "pan" &&
        currentTool !== "text"
      )
        startAction(ev);
    },
    { passive: true }
  );
  canvas.addEventListener(
    "touchmove",
    (ev) => {
      if (
        ev.touches.length === 1 &&
        currentTool !== "pan" &&
        currentTool !== "text"
      ) {
        ev.preventDefault();
        moveAction(ev);
      }
    },
    { passive: false }
  );
  canvas.addEventListener("touchend", stopAction);
}

function undoAction() {
  const activePage = getActivePageWrapper();
  if (!activePage) return;
  const canvas = activePage.querySelector(".drawing-page-canvas");
  if (canvas && canvas.undoStack && canvas.undoStack.length > 1) {
    const current = canvas.undoStack.pop();
    canvas.redoStack.push(current);
    const prevState = canvas.undoStack[canvas.undoStack.length - 1];
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = prevState;
  }
}
function redoAction() {
  const activePage = getActivePageWrapper();
  if (!activePage) return;
  const canvas = activePage.querySelector(".drawing-page-canvas");
  if (canvas && canvas.redoStack && canvas.redoStack.length > 0) {
    const nextState = canvas.redoStack.pop();
    canvas.undoStack.push(nextState);
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = nextState;
  }
}
function clearCurrentDrawings() {
  const activePage = getActivePageWrapper();
  if (!activePage) return;
  const canvas = activePage.querySelector(".drawing-page-canvas");
  if (canvas) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const currentState = canvas.toDataURL();
    canvas.undoStack.push(currentState);
    canvas.redoStack = [];
    showNotification("ล้างหน้าประวัติวาดเขียนแล้วค่ะ");
  }
}
  if (activePage)
    activePage
      .querySelectorAll(".word-text-node")
      .forEach((node) => (pageText += node.innerText + " "));

  if (!pageText.trim()) {
    appendAiMessage("ai", "❌ หน้านี้ไม่มีข้อความธรรมดาให้ดึงไปวิเคราะห์ค่ะ");
    return;
  }

  appendAiMessage("system", "⚡ กำลังอ่านวิเคราะห์รายงานตารางหน้านี้ให้ค่ะ...");
  const prompt = `จงสรุปสาระสำคัญ ตัวเลข หรือตารางข้อมูลจากรายงานหน้านี้อย่างเป็นขั้นเป็นตอนและถูกต้อง:\n"""\n${pageText}\n"""`;
  const result = await callGeminiAPI(prompt);
  appendAiMessage("ai", result);
}

function appendAiMessage(sender, text) {
  const chatBox = document.getElementById("ai-chat-box");
  if (!chatBox) return;
  if (sender === "system") {
    const tempMsg = document.createElement("div");
    tempMsg.className = "ai-message system-msg temp-status";
    tempMsg.innerText = text;
    chatBox.appendChild(tempMsg);
    chatBox.scrollTop = chatBox.scrollHeight;
    return;
  }
  const tempStatus = chatBox.querySelector(".temp-status");
  if (tempStatus) tempStatus.remove();

  const msgDiv = document.createElement("div");
  msgDiv.className = `ai-message ${sender}-msg`;
  msgDiv.innerText = text;
  chatBox.appendChild(msgDiv);
  chatBox.scrollTop = chatBox.scrollHeight;
}

