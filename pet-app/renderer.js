(function () {
  const stage = document.getElementById("stage");
  const pet = document.getElementById("pet");
  const bubble = document.getElementById("bubble");
  const manifest = window.deskpet.manifest;
  const config = window.deskpet.config;
  const assetBaseUrl = window.deskpet.assetBaseUrl;
  const sourceWidth = manifest.assetSize?.width || 1000;
  const sourceHeight = manifest.assetSize?.height || sourceWidth;
  const scale = Number.isFinite(config.scale) ? config.scale : manifest.defaultScale || 0.32;
  const stageWidth = Math.max(96, Math.round(sourceWidth * scale));
  const stageHeight = Math.max(96, Math.round(sourceHeight * scale));

  const state = {
    action: manifest.defaultAction,
    visualVariant: "still",
    visualRevision: 0,
    direction: 1,
    reportedReady: false,
    pointerDown: false,
    pointerId: undefined,
    startX: 0,
    startY: 0,
    dragStarted: false,
    nativeDragStarted: false,
    longPressed: false,
    longPressTimer: undefined,
    bubbleTimer: undefined,
    bubblePinned: false
  };

  function assetUrl(file) {
    if (!file) {
      return "";
    }

    return `${assetBaseUrl}${encodeURIComponent(file).replace(/%2F/g, "/")}`;
  }

  function resolveAction(actionName) {
    return manifest.actions?.[actionName] || manifest.actions?.[manifest.defaultAction];
  }

  function actionFile(action, visualVariant) {
    if (visualVariant === "still") {
      return action.still || action.animated;
    }

    return action.animated || action.still;
  }

  function setAction(actionName, visualVariant = "animated", forceReplay = false) {
    const action = resolveAction(actionName);
    if (!action) {
      return;
    }

    const src = assetUrl(actionFile(action, visualVariant));
    if (src && (forceReplay || pet.src !== src)) {
      pet.src = "";
      requestAnimationFrame(() => {
        pet.src = src;
      });
    }
    pet.dataset.action = actionName;
    pet.dataset.variant = visualVariant;
  }

  function reportReadyOnce() {
    if (state.reportedReady) {
      return;
    }

    state.reportedReady = true;
    window.deskpet.ready({ width: stageWidth, height: stageHeight });
  }

  function setDirection(direction) {
    state.direction = direction < 0 ? -1 : 1;
    pet.style.transform = state.direction < 0 ? "scaleX(-1)" : "scaleX(1)";
  }

  function showBubble(text, durationMs = 2400, pinned = false, logicState = "idle") {
    if (!text) {
      bubble.hidden = true;
      return;
    }

    bubble.textContent = text;
    bubble.dataset.state = logicState;
    bubble.hidden = false;
    state.bubblePinned = pinned;
    clearTimeout(state.bubbleTimer);
    if (!pinned && durationMs > 0) {
      state.bubbleTimer = setTimeout(() => {
        bubble.hidden = true;
      }, durationMs);
    }
  }

  function updateBubble(bubbleState) {
    if (!bubbleState || !bubbleState.visible || !bubbleState.text) {
      bubble.hidden = true;
      clearTimeout(state.bubbleTimer);
      state.bubblePinned = false;
      return;
    }

    showBubble(
      bubbleState.text,
      bubbleState.durationMs || 2400,
      Boolean(bubbleState.pinned),
      bubbleState.state || "idle"
    );
  }

  function clearLongPressTimer() {
    if (state.longPressTimer) {
      clearTimeout(state.longPressTimer);
      state.longPressTimer = undefined;
    }
  }

  function beginNativeDrag() {
    if (state.nativeDragStarted) {
      return;
    }

    state.nativeDragStarted = true;
    window.deskpet.pointerDown({ x: state.startX, y: state.startY });
  }

  function handlePointerDown(event) {
    if (event.button === 2) {
      return;
    }

    state.pointerDown = true;
    state.pointerId = event.pointerId;
    state.startX = event.clientX;
    state.startY = event.clientY;
    state.dragStarted = false;
    state.nativeDragStarted = false;
    state.longPressed = false;
    stage.setPointerCapture(event.pointerId);
    clearLongPressTimer();
    state.longPressTimer = setTimeout(() => {
      if (!state.pointerDown || state.dragStarted) {
        return;
      }

      state.longPressed = true;
      window.deskpet.longPress();
      beginNativeDrag();
    }, 650);
  }

  function handlePointerMove(event) {
    if (!state.pointerDown || state.dragStarted) {
      return;
    }

    if (!state.longPressed) {
      return;
    }

    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (Math.hypot(dx, dy) < 5) {
      return;
    }

    state.dragStarted = true;
    clearLongPressTimer();
    document.body.classList.add("dragging");
    beginNativeDrag();
  }

  function handlePointerUp(event) {
    const wasDrag = state.dragStarted;
    const wasLongPress = state.longPressed;
    const shouldEndNativeDrag = state.nativeDragStarted || wasDrag || wasLongPress;
    state.pointerDown = false;
    state.pointerId = undefined;
    state.dragStarted = false;
    state.nativeDragStarted = false;
    state.longPressed = false;
    clearLongPressTimer();
    document.body.classList.remove("dragging");

    try {
      stage.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture can be gone after the native window moves.
    }

    if (shouldEndNativeDrag) {
      window.deskpet.pointerUp();
    } else {
      window.deskpet.click();
    }
  }

  window.deskpet.onState((nextState) => {
    if (nextState.direction !== undefined) {
      setDirection(nextState.direction);
    }
    if (Number.isFinite(nextState.visualRevision) && nextState.visualRevision !== state.visualRevision) {
      state.visualRevision = nextState.visualRevision;
      state.action = nextState.action || state.action;
      state.visualVariant = nextState.visualVariant || state.visualVariant;
      setAction(state.action, state.visualVariant, true);
    } else if (
      nextState.action
      && (nextState.action !== state.action || nextState.visualVariant !== state.visualVariant)
    ) {
      state.action = nextState.action;
      state.visualVariant = nextState.visualVariant || state.visualVariant;
      setAction(nextState.action, state.visualVariant);
    }
    if (nextState.bubble) {
      updateBubble(nextState.bubble);
    }
  });

  stage.addEventListener("pointerdown", handlePointerDown);
  stage.addEventListener("pointermove", handlePointerMove);
  stage.addEventListener("pointerup", handlePointerUp);
  stage.addEventListener("pointercancel", handlePointerUp);
  stage.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    window.deskpet.contextMenu();
  });

  pet.addEventListener("load", reportReadyOnce, { once: true });
  pet.addEventListener("error", () => {
    const action = resolveAction(state.action);
    const fallback = assetUrl(action?.still);
    if (fallback && pet.src !== fallback) {
      pet.src = fallback;
      return;
    }

    reportReadyOnce();
  });

  stage.style.width = `${stageWidth}px`;
  stage.style.height = `${stageHeight}px`;
  pet.style.width = `${stageWidth}px`;
  pet.style.height = `${stageHeight}px`;
  setAction(state.action, state.visualVariant);

  if (pet.complete) {
    reportReadyOnce();
  }
})();
