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
    direction: 1,
    reportedReady: false,
    pointerDown: false,
    pointerId: undefined,
    startX: 0,
    startY: 0,
    dragStarted: false,
    bubbleTimer: undefined
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

  function setAction(actionName) {
    const action = resolveAction(actionName);
    if (!action) {
      return;
    }

    const src = assetUrl(action.animated || action.still);
    if (src && pet.src !== src) {
      pet.src = src;
    }
    pet.dataset.action = actionName;
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

  function showBubble(text, durationMs = 2400) {
    if (!text) {
      bubble.hidden = true;
      return;
    }

    bubble.textContent = text;
    bubble.hidden = false;
    clearTimeout(state.bubbleTimer);
    state.bubbleTimer = setTimeout(() => {
      bubble.hidden = true;
    }, durationMs);
  }

  function updateProjectBubble(projectState) {
    if (!projectState) {
      return;
    }

    const errors = projectState.diagnostics?.errors || 0;
    const warnings = projectState.diagnostics?.warnings || 0;
    const dirtyFiles = projectState.git?.dirtyFiles || 0;

    if (errors > 0) {
      showBubble(`${errors} error${errors === 1 ? "" : "s"}`);
    } else if (warnings > 0) {
      showBubble(`${warnings} warning${warnings === 1 ? "" : "s"}`);
    } else if (dirtyFiles > 0) {
      showBubble(`${dirtyFiles} changed`);
    }
  }

  function handlePointerDown(event) {
    state.pointerDown = true;
    state.pointerId = event.pointerId;
    state.startX = event.clientX;
    state.startY = event.clientY;
    state.dragStarted = false;
    stage.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event) {
    if (!state.pointerDown || state.dragStarted) {
      return;
    }

    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (Math.hypot(dx, dy) < 5) {
      return;
    }

    state.dragStarted = true;
    document.body.classList.add("dragging");
    window.deskpet.pointerDown({ x: state.startX, y: state.startY });
  }

  function handlePointerUp(event) {
    const wasDrag = state.dragStarted;
    state.pointerDown = false;
    state.pointerId = undefined;
    state.dragStarted = false;
    document.body.classList.remove("dragging");

    try {
      stage.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture can be gone after the native window moves.
    }

    if (wasDrag) {
      window.deskpet.pointerUp();
    } else {
      window.deskpet.click();
    }
  }

  window.deskpet.onState((nextState) => {
    if (nextState.direction !== undefined) {
      setDirection(nextState.direction);
    }
    if (nextState.action && nextState.action !== state.action) {
      state.action = nextState.action;
      setAction(nextState.action);
    }
    if (nextState.projectState) {
      updateProjectBubble(nextState.projectState);
    }
  });

  stage.addEventListener("pointerdown", handlePointerDown);
  stage.addEventListener("pointermove", handlePointerMove);
  stage.addEventListener("pointerup", handlePointerUp);
  stage.addEventListener("pointercancel", handlePointerUp);

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
  setAction(state.action);

  if (pet.complete) {
    reportReadyOnce();
  }
})();
