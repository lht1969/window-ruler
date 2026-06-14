/**
 * Window Ruler - 屏幕量尺工具前端核心逻辑
 *
 * 功能说明：
 * - 支持鼠标拖拽测量两点间距离和矩形长宽
 * - 实时显示测量区域到屏幕四边缘的距离
 * - 按 S 键保存测量数据到剪贴板
 * - 按 ESC 键退出量尺模式
 * - 通过 Rust 端轮询检测鼠标下窗口，实现坐标系自动切换
 */

const { invoke } = window.__TAURI__.core;

// ============================================
// 状态管理
// ============================================

/** 应用运行模式 */
const AppMode = {
  MAIN: 'main',
  RULER: 'ruler'
};

/** 测量状态 */
const MeasureState = {
  IDLE: 'idle',
  DRAGGING: 'dragging',
  COMPLETED: 'completed'
};

/** 像素测量模式状态 */
const PixelMeasureMode = {
  OFF: 'off',
  ON: 'on'
};

/** 坐标系类型 */
const CoordSystem = {
  SCREEN: 'screen',  // 屏幕坐标系 - 相对于整个屏幕
  WINDOW: 'window'   // 窗口坐标系 - 相对于当前目标窗口
};

/** 全局状态对象 */
const state = {
  mode: AppMode.MAIN,
  measureState: MeasureState.IDLE,
  pixelMeasureMode: PixelMeasureMode.OFF,
  coordSystem: CoordSystem.SCREEN,  // 默认屏幕坐标系
  startPoint: { x: 0, y: 0 },
  endPoint: { x: 0, y: 0 },
  currentPoint: { x: 0, y: 0 },
  screenSize: { width: 0, height: 0 },
  rulerPosition: { x: 0, y: 0 },
  isRulerWindow: false,
  targetWindow: null,
  pollTimer: null,
  // 像素测量结果缓存
  pixelResult: null
};

// ============================================
// DOM 元素引用
// ============================================

let mainUi, rulerOverlay, rulerCanvas, ctx;
let infoPanel, infoDistance, infoWidth, infoHeight;
let infoLeft, infoRight, infoTop, infoBottom;
// 信息面板头部元素（拖动、收敛/展开、摘要）
let infoPanelHeader, infoPanelDrag, infoPanelToggle, infoPanelSummary, infoPanelBody;
let cursorTooltip, cursorX, cursorY;
let saveToast, saveToastIcon, saveToastMessage;
// 目标窗口信息已移除
// 像素测量相关 DOM 元素
let pixelSection, pixelColorPreview, pixelWidthInfo, pixelHeightInfo;
// 模式指示相关 DOM 元素
let modeBadge;
// 操作提示元素
let actionHint;
// 工具栏相关 DOM 元素
let toolbar, btnRectMeasure, btnCrosshairMeasure, btnCoordSystem, btnExit, btnAbout;

// ============================================
// 初始化
// ============================================

/**
 * 初始化应用
 * 根据 URL 参数判断当前是主窗口还是量尺窗口
 */
function init() {
  const urlParams = new URLSearchParams(window.location.search);
  const mode = urlParams.get('mode');
  const pixelMode = urlParams.get('pixel');

  state.isRulerWindow = mode === 'ruler';
  state.mode = state.isRulerWindow ? AppMode.RULER : AppMode.MAIN;

  cacheElements();

  if (state.isRulerWindow) {
    initRulerMode(pixelMode === '1');
  } else {
    initMainMode();
  }
}

/**
 * 缓存 DOM 元素引用，避免重复查询
 */
function cacheElements() {
  mainUi = document.getElementById('main-ui');
  rulerOverlay = document.getElementById('ruler-overlay');
  rulerCanvas = document.getElementById('ruler-canvas');

  infoPanel = document.getElementById('info-panel');
  infoDistance = document.getElementById('info-distance');
  infoWidth = document.getElementById('info-width');
  infoHeight = document.getElementById('info-height');
  infoLeft = document.getElementById('info-left');
  infoRight = document.getElementById('info-right');
  infoTop = document.getElementById('info-top');
  infoBottom = document.getElementById('info-bottom');

  cursorTooltip = document.getElementById('cursor-tooltip');
  cursorX = document.getElementById('cursor-x');
  cursorY = document.getElementById('cursor-y');

  saveToast = document.getElementById('save-toast');
  saveToastIcon = document.getElementById('save-toast-icon');
  saveToastMessage = document.getElementById('save-toast-message');

  // 信息面板头部元素（拖动、收敛/展开、摘要）
  infoPanelHeader = document.getElementById('info-panel-header');
  infoPanelDrag = document.getElementById('info-panel-drag');
  infoPanelToggle = document.getElementById('info-panel-toggle');
  infoPanelSummary = document.getElementById('info-panel-summary');
  infoPanelBody = document.getElementById('info-panel-body');

  // 像素测量区域元素
  pixelSection = document.getElementById('pixel-section');
  pixelColorPreview = document.getElementById('pixel-color-preview');
  pixelWidthInfo = document.getElementById('pixel-width-info');
  pixelHeightInfo = document.getElementById('pixel-height-info');
  // 模式指示元素
  modeBadge = document.getElementById('mode-badge');
  actionHint = document.getElementById('action-hint');
  // 工具栏元素
  toolbar = document.getElementById('toolbar');
  btnRectMeasure = document.getElementById('btn-rect-measure');
  btnCrosshairMeasure = document.getElementById('btn-crosshair-measure');
  btnExit = document.getElementById('btn-exit');
  btnCoordSystem = document.getElementById('btn-coord-system');
  btnAbout = document.getElementById('btn-about');
}

// ============================================
// 主窗口模式
// ============================================

/**
 * 初始化主窗口模式（工具栏）
 */
function initMainMode() {
  invoke('position_toolbar').catch(err => {
    console.warn('定位工具栏失败:', err);
  });
  bindToolbarEvents();
}

function bindToolbarEvents() {
  if (btnRectMeasure) {
    btnRectMeasure.addEventListener('click', onRectMeasure);
  }
  if (btnCrosshairMeasure) {
    btnCrosshairMeasure.addEventListener('click', onCrosshairMeasure);
  }
  if (btnExit) {
    btnExit.addEventListener('click', onExitApp);
  }
  if (btnCoordSystem) {
    btnCoordSystem.addEventListener('click', () => {
      // 工具栏按钮：仅切换预存状态，不依赖 targetWindow
      if (state.coordSystem === CoordSystem.SCREEN) {
        state.coordSystem = CoordSystem.WINDOW;
      } else {
        state.coordSystem = CoordSystem.SCREEN;
      }
      try { localStorage.setItem('coordSystem', state.coordSystem); } catch (_) { }
      if (btnCoordSystem) {
        btnCoordSystem.textContent = state.coordSystem === CoordSystem.WINDOW ? '窗口坐标系' : '屏幕坐标系';
        // 窗口坐标系时按钮显示绿色，提供明确视觉提示
        btnCoordSystem.classList.toggle('toolbar-btn-window-coord', state.coordSystem === CoordSystem.WINDOW);
      }
    });
  }
  // 关于按钮事件 - 调用 Rust 命令创建关于窗口
  if (btnAbout) {
    btnAbout.addEventListener('click', async () => {
      try {
        await invoke('create_about_window');
      } catch (err) {
        console.error('打开关于窗口失败:', err);
      }
    });
  }
}

async function onRectMeasure() {
  try {
    await invoke('hide_main_window');
    await invoke('create_ruler_window', { pixelMode: false, coordSystem: state.coordSystem });
  } catch (err) {
    console.error('启动矩形测量失败:', err);
  }
}

async function onCrosshairMeasure() {
  try {
    await invoke('hide_main_window');
    await invoke('create_ruler_window', { pixelMode: true, coordSystem: state.coordSystem });
  } catch (err) {
    console.error('启动十字线测量失败:', err);
  }
}

async function onExitApp() {
  try {
    await invoke('exit_app');
  } catch (err) {
    console.error('退出程序失败:', err);
  }
}

// ============================================
// 量尺模式
// ============================================

/**
 * 初始化量尺覆盖层模式
 */
async function initRulerMode(enterPixelMode) {
  // 隐藏工具栏，显示量尺覆盖层
  if (toolbar) toolbar.style.display = 'none';
  if (rulerOverlay) {
    rulerOverlay.classList.add('active');
    rulerOverlay.setAttribute('aria-hidden', 'false');
  }

  // 确保启用点击穿透
  try {
    await invoke('enable_click_through');
  } catch (err) {
    console.warn('启用点击穿透失败:', err);
  }

  // 初始化 Canvas
  ctx = rulerCanvas.getContext('2d');
  resizeCanvas();

  // 获取量尺窗口在屏幕上的位置（用于坐标转换）
  state.rulerPosition.x = window.screenX;
  state.rulerPosition.y = window.screenY;

  // 获取屏幕尺寸
  try {
    const screenInfo = await invoke('get_screen_size');
    state.screenSize.width = screenInfo.width;
    state.screenSize.height = screenInfo.height;
  } catch (err) {
    console.warn('获取屏幕尺寸失败，使用窗口尺寸:', err);
    state.screenSize.width = window.innerWidth;
    state.screenSize.height = window.innerHeight;
  }

  // 恢复坐标系设置：优先使用 URL 参数，其次使用 localStorage
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const urlCoord = urlParams.get('coord');
    if (urlCoord === CoordSystem.WINDOW || urlCoord === CoordSystem.SCREEN) {
      state.coordSystem = urlCoord;
    } else {
      const saved = localStorage.getItem('coordSystem');
      if (saved === CoordSystem.WINDOW || saved === CoordSystem.SCREEN) {
        state.coordSystem = saved;
      }
    }
  } catch (_) { }

  // 绑定事件
  bindRulerEvents();

  // 启动窗口检测轮询
  startPolling();

  // 初始绘制
  draw();

  // 更新模式指示
  updateModeIndicator();
  // 更新坐标系指示器
  updateCoordSystemIndicator();

  // 工具栏启动十字线测量时自动进入像素测量模式
  if (enterPixelMode) {
    setTimeout(() => togglePixelMeasureMode(), 200);
  }

  // 初始化信息面板交互（拖动、收敛/展开）
  initInfoPanelInteraction();
}

/**
 * 初始化信息面板交互功能
 * - 拖动：按住头部区域可拖动面板到任意位置
 * - 收敛/展开：点击按钮可将面板收敛为横幅，再次点击展开
 * - 摘要：收敛时在横幅中显示关键测量信息
 * - 位置持久化：面板位置和收敛状态保存到 localStorage
 */
function initInfoPanelInteraction() {
  if (!infoPanel) return;

  // ---- 收敛/展开功能 ----
  if (infoPanelToggle) {
    infoPanelToggle.addEventListener('click', (e) => {
      e.stopPropagation(); // 防止触发拖动
      infoPanel.classList.toggle('collapsed');
      const isCollapsed = infoPanel.classList.contains('collapsed');
      // 更新箭头方向（CSS 通过 .collapsed 自动旋转）
      infoPanelToggle.textContent = isCollapsed ? '\u25B2' : '\u25BC';
      // 持久化收敛状态
      try { localStorage.setItem('infoPanelCollapsed', isCollapsed); } catch (_) { }
      // 收敛时更新摘要内容
      if (isCollapsed) {
        updateInfoPanelSummary();
      }
    });
  }

  // 从 localStorage 恢复收敛状态
  try {
    const collapsed = localStorage.getItem('infoPanelCollapsed') === 'true';
    if (collapsed) {
      infoPanel.classList.add('collapsed');
      if (infoPanelToggle) infoPanelToggle.textContent = '\u25B2';
    }
  } catch (_) { }

  // ---- 拖动功能 ----
  let isDragging = false;
  let dragStartX = 0, dragStartY = 0;
  let panelStartLeft = 0, panelStartTop = 0;

  if (infoPanelHeader) {
    infoPanelHeader.addEventListener('mousedown', (e) => {
      // 点击按钮时不触发拖动
      if (e.target === infoPanelToggle) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const rect = infoPanel.getBoundingClientRect();
      panelStartLeft = rect.left;
      panelStartTop = rect.top;
      // 切换到 left/top 定位，移除 right 定位
      infoPanel.style.left = panelStartLeft + 'px';
      infoPanel.style.top = panelStartTop + 'px';
      infoPanel.style.right = 'auto';
      infoPanel.style.cursor = 'grabbing';
      e.preventDefault(); // 防止选中文字
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - dragStartX;
      const deltaY = e.clientY - dragStartY;
      let newLeft = panelStartLeft + deltaX;
      let newTop = panelStartTop + deltaY;

      // 限制面板不超出视口边界
      const panelW = infoPanel.offsetWidth;
      const panelH = infoPanel.offsetHeight;
      const viewW = window.innerWidth;
      const viewH = window.innerHeight;
      newLeft = Math.max(0, Math.min(newLeft, viewW - panelW));
      newTop = Math.max(0, Math.min(newTop, viewH - panelH));

      infoPanel.style.left = newLeft + 'px';
      infoPanel.style.top = newTop + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      infoPanel.style.cursor = '';
      // 持久化面板位置
      try {
        const rect = infoPanel.getBoundingClientRect();
        localStorage.setItem('infoPanelPosition', JSON.stringify({
          left: rect.left,
          top: rect.top
        }));
      } catch (_) { }
    });
  }

  // 从 localStorage 恢复面板位置
  try {
    const pos = JSON.parse(localStorage.getItem('infoPanelPosition'));
    if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
      // 确保恢复的位置在当前视口范围内
      const viewW = window.innerWidth;
      const viewH = window.innerHeight;
      const panelW = infoPanel.offsetWidth;
      const panelH = infoPanel.offsetHeight;
      const left = Math.max(0, Math.min(pos.left, viewW - panelW));
      const top = Math.max(0, Math.min(pos.top, viewH - panelH));
      infoPanel.style.left = left + 'px';
      infoPanel.style.top = top + 'px';
      infoPanel.style.right = 'auto';
    }
  } catch (_) { }

  // 初始更新摘要
  updateInfoPanelSummary();
}

/**
 * 更新信息面板摘要内容（收敛时显示关键信息）
 */
function updateInfoPanelSummary() {
  if (!infoPanelSummary) return;

  if (state.measureState === MeasureState.IDLE) {
    infoPanelSummary.textContent = '就绪';
    return;
  }

  const dist = Math.round(getDistance(state.startPoint, state.endPoint));
  const rect = getRectDimensions(state.startPoint, state.endPoint);

  if (state.pixelMeasureMode === PixelMeasureMode.ON && state.pixelResult) {
    // 十字线模式摘要
    infoPanelSummary.textContent = `W:${state.pixelResult.width} H:${state.pixelResult.height}`;
  } else {
    // 矩形模式摘要
    infoPanelSummary.textContent = `${dist}px | ${rect.width}\u00D7${rect.height}`;
  }
}

/**
 * 启动前端轮询检测鼠标下的窗口
 * 每100ms调用一次 Rust 命令获取当前鼠标下的窗口信息
 */
function startPolling() {
  async function poll() {
    try {
      const winInfo = await invoke('get_window_under_mouse');

      if (winInfo.exists && !winInfo.is_own_window && winInfo.title) {
        const newTitle = winInfo.title || '未命名窗口';
        const newRect = winInfo.rect;
        const sameTarget = state.targetWindow &&
          state.targetWindow.rect.left === newRect.left &&
          state.targetWindow.rect.top === newRect.top &&
          state.targetWindow.rect.right === newRect.right &&
          state.targetWindow.rect.bottom === newRect.bottom &&
          state.targetWindow.title === newTitle;

        if (!sameTarget) {
          state.targetWindow = {
            title: newTitle,
            rect: newRect,
            width: newRect.right - newRect.left,
            height: newRect.bottom - newRect.top
          };
          requestDraw();
        }
      } else {
        if (state.targetWindow) {
          state.targetWindow = null;
          requestDraw();
        }
      }
    } catch (err) {
      // 忽略轮询错误
    }
  }

  state.pollTimer = setInterval(poll, 300);
  poll(); // 立即执行第一次
}

/**
 * 调整 Canvas 尺寸匹配窗口
 */
function resizeCanvas() {
  if (!rulerCanvas) return;
  const dpr = window.devicePixelRatio || 1;
  rulerCanvas.width = window.innerWidth * dpr;
  rulerCanvas.height = window.innerHeight * dpr;
  rulerCanvas.style.width = window.innerWidth + 'px';
  rulerCanvas.style.height = window.innerHeight + 'px';
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

/**
 * 绑定量尺模式的事件监听器
 */
function bindRulerEvents() {
  // 鼠标事件
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  // 键盘事件
  document.addEventListener('keydown', onKeyDown);

  // 窗口大小变化
  window.addEventListener('resize', () => {
    resizeCanvas();
    draw();
  });
}

// ============================================
// 鼠标事件处理
// ============================================

/**
 * 获取基于目标窗口的局部坐标（如果存在目标窗口）
 * @param {number} screenX - 屏幕绝对坐标 X
 * @param {number} screenY - 屏幕绝对坐标 Y
 * @returns {{ x: number, y: number, screenX: number, screenY: number, baseRect: object }}
 *
 * 返回的 x/y 为画布坐标（相对于量尺窗口视口左上角），用于 Canvas 绘制
 * screenX/screenY 为屏幕绝对坐标，用于信息面板中的局部坐标推导
 * baseRect 为当前坐标系的边界矩形（目标窗口或屏幕）
 */
function getLocalCoords(screenX, screenY) {
  // 画布坐标 = 屏幕坐标 - 量尺窗口在屏幕上的偏移
  const canvasX = screenX - state.rulerPosition.x;
  const canvasY = screenY - state.rulerPosition.y;

  const baseRect = (state.coordSystem === CoordSystem.WINDOW && state.targetWindow)
    ? state.targetWindow.rect
    : { left: 0, top: 0, right: state.screenSize.width, bottom: state.screenSize.height };

  return {
    x: canvasX,
    y: canvasY,
    screenX,
    screenY,
    baseRect
  };
}

/**
 * 鼠标按下 - 开始测量
 */
async function onMouseDown(e) {
  if (e.button !== 0) return; // 仅响应左键

  // 十字线测量模式下禁止鼠标按下进入矩形拖拽测量
  if (state.pixelMeasureMode === PixelMeasureMode.ON) return;

  // 禁用点击穿透，以便捕获鼠标事件
  try {
    await invoke('disable_click_through');
  } catch (err) {
    console.warn('禁用点击穿透失败:', err);
  }

  // 获取局部坐标（传入屏幕绝对坐标）
  const local = getLocalCoords(e.screenX, e.screenY);

  state.measureState = MeasureState.DRAGGING;
  state.startPoint = { x: local.x, y: local.y, screenX: local.screenX, screenY: local.screenY };
  state.endPoint = { x: local.x, y: local.y, screenX: local.screenX, screenY: local.screenY };
  state.currentPoint = { x: local.x, y: local.y, screenX: local.screenX, screenY: local.screenY };

  updateInfoPanel();
  requestDraw();
}

/**
 * 鼠标移动 - 更新测量
 */
function onMouseMove(e) {
  // 获取局部坐标（传入屏幕绝对坐标）
  const local = getLocalCoords(e.screenX, e.screenY);
  state.currentPoint = { x: local.x, y: local.y, screenX: local.screenX, screenY: local.screenY };

  // 根据用户选择的坐标系计算显示坐标
  const displayX = (state.coordSystem === CoordSystem.WINDOW && state.targetWindow)
    ? (e.screenX - state.targetWindow.rect.left)
    : local.x;
  const displayY = (state.coordSystem === CoordSystem.WINDOW && state.targetWindow)
    ? (e.screenY - state.targetWindow.rect.top)
    : local.y;

  // 更新坐标提示（使用视口坐标定位 UI，显示坐标值用当前坐标系）
  updateCursorTooltip(e.clientX, e.clientY, displayX, displayY);

  // 像素测量模式：节流测量，减少闪烁（50ms ≈ 20fps）
  if (state.pixelMeasureMode === PixelMeasureMode.ON && state.measureState === MeasureState.IDLE) {
    const now = Date.now();
    if (!state._lastPixelMeasureTime || now - state._lastPixelMeasureTime >= 50) {
      state._lastPixelMeasureTime = now;
      performPixelMeasurement(e.screenX, e.screenY);
    }
  }

  if (state.measureState === MeasureState.DRAGGING) {
    state.endPoint = { x: local.x, y: local.y, screenX: local.screenX, screenY: local.screenY };
    updateInfoPanel();
    requestDraw();
  } else {
    const edgeX = (state.coordSystem === CoordSystem.WINDOW && state.targetWindow)
      ? local.screenX - state.targetWindow.rect.left
      : local.x;
    const edgeY = (state.coordSystem === CoordSystem.WINDOW && state.targetWindow)
      ? local.screenY - state.targetWindow.rect.top
      : local.y;
    updateEdgeDistances(edgeX, edgeY, local.baseRect);
  }
}

/**
 * 鼠标释放 - 完成测量
 */
async function onMouseUp(e) {
  if (state.measureState !== MeasureState.DRAGGING) return;

  // 获取局部坐标（传入屏幕绝对坐标）
  const local = getLocalCoords(e.screenX, e.screenY);

  state.measureState = MeasureState.COMPLETED;
  state.endPoint = { x: local.x, y: local.y, screenX: local.screenX, screenY: local.screenY };

  // 不在像素测量模式时才重新启用点击穿透（像素模式需要持续拦截鼠标）
  if (state.pixelMeasureMode === PixelMeasureMode.OFF) {
    try {
      await invoke('enable_click_through');
    } catch (err) {
      console.warn('启用点击穿透失败:', err);
    }
  }

  updateInfoPanel();
  requestDraw();
}

// ============================================
// 键盘事件处理
// ============================================

/**
 * 键盘按键处理
 * S: 保存数据到剪贴板
 * X: 截取测量区域截图到剪贴板
 * C: 切换坐标系
 * ESC: 退出量尺模式
 */
function onKeyDown(e) {
  const key = e.key.toLowerCase();

  if (key === 's' && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    saveMeasurement();
  } else if (key === 'x' && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    captureScreenshot();
  } else if (key === 'c' && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    toggleCoordSystem();
  } else if (key === 'escape') {
    e.preventDefault();
    exitRulerMode();
  }
}

// ============================================
// 像素颜色测量模式
// ============================================

/**
 * 切换像素测量模式
 * 进入时禁用点击穿透（让量尺捕获鼠标事件），退出时恢复
 */
async function togglePixelMeasureMode() {
  if (state.pixelMeasureMode === PixelMeasureMode.OFF) {
    state.pixelMeasureMode = PixelMeasureMode.ON;
    if (pixelSection) {
      pixelSection.style.display = 'block';
      pixelSection.setAttribute('aria-hidden', 'false');
    }
    updateModeIndicator();
    // 禁用点击穿透，拦截所有鼠标事件（防止点击穿透到下层窗口）
    try {
      await invoke('disable_click_through');
    } catch (_) { }
  } else {
    state.pixelMeasureMode = PixelMeasureMode.OFF;
    state.pixelResult = null;
    showToast('success', '像素测量模式已关闭');
    if (pixelSection) {
      pixelSection.style.display = 'none';
      pixelSection.setAttribute('aria-hidden', 'true');
    }
    updateModeIndicator();
    // 恢复点击穿透，允许与下层窗口交互
    try {
      await invoke('enable_click_through');
    } catch (_) { }
    // 重新获取焦点（WS_EX_TRANSPARENT 恢复后可能被 Windows 回收）
    try {
      await invoke('focus_ruler_window');
    } catch (_) { }
  }
  requestDraw();
}

/**
 * 更新模式指示器显示
 */
function updateModeIndicator() {
  if (!modeBadge) return;
  if (state.pixelMeasureMode === PixelMeasureMode.ON) {
    modeBadge.textContent = '十字线测量';
    modeBadge.className = 'mode-badge mode-badge-crosshair';
    if (actionHint) actionHint.textContent = '移动鼠标测量 | C 切换坐标系 | S 保存 | X 截屏 | ESC 退出';
  } else {
    modeBadge.textContent = '矩形测量';
    modeBadge.className = 'mode-badge mode-badge-rect';
    if (actionHint) actionHint.textContent = '拖拽鼠标测量 | C 切换坐标系 | S 保存 | X 截屏 | ESC 退出';
  }
}

/**
 * 更新像素测量信息面板显示
 */
function updatePixelMeasureInfo(result) {
  if (!result) {
    if (pixelWidthInfo) pixelWidthInfo.textContent = '0 px';
    if (pixelHeightInfo) pixelHeightInfo.textContent = '0 px';
    if (pixelColorPreview) pixelColorPreview.style.backgroundColor = '#000000';
    if (infoWidth) infoWidth.textContent = '0 px';
    if (infoHeight) infoHeight.textContent = '0 px';
    if (infoLeft) infoLeft.textContent = '0 px';
    if (infoRight) infoRight.textContent = '0 px';
    if (infoTop) infoTop.textContent = '0 px';
    if (infoBottom) infoBottom.textContent = '0 px';
    return;
  }

  const [r, g, b] = result.base_color;
  const colorStr = `rgb(${r}, ${g}, ${b})`;
  const hexStr = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;

  if (pixelWidthInfo) pixelWidthInfo.textContent = result.width + ' px';
  if (pixelHeightInfo) pixelHeightInfo.textContent = result.height + ' px';
  if (pixelColorPreview) {
    pixelColorPreview.style.backgroundColor = colorStr;
    pixelColorPreview.setAttribute('aria-label', `基准颜色: ${hexStr}`);
  }

  // 更新主信息面板的边缘距离
  if (infoWidth) infoWidth.textContent = result.width + ' px';
  if (infoHeight) infoHeight.textContent = result.height + ' px';

  const baseRect = (state.coordSystem === CoordSystem.WINDOW && state.targetWindow) ? state.targetWindow.rect : null;
  const regionStart = {
    x: result.left - state.rulerPosition.x,
    y: result.top - state.rulerPosition.y,
    screenX: result.left,
    screenY: result.top
  };
  const regionEnd = {
    x: result.right - state.rulerPosition.x,
    y: result.bottom - state.rulerPosition.y,
    screenX: result.right,
    screenY: result.bottom
  };
  const p1 = getInfoPoint(regionStart);
  const p2 = getInfoPoint(regionEnd);
  const edges = getRectEdgeDistances(p1, p2, baseRect);

  if (infoLeft) infoLeft.textContent = edges.left + ' px';
  if (infoRight) infoRight.textContent = edges.right + ' px';
  if (infoTop) infoTop.textContent = edges.top + ' px';
  if (infoBottom) infoBottom.textContent = edges.bottom + ' px';

  // 更新收敛状态下的摘要信息
  updateInfoPanelSummary();
}

/**
 * 执行像素颜色边界测量
 * 调用 Rust 后端获取鼠标位置处同色像素的边界范围
 */
async function performPixelMeasurement(screenX, screenY) {
  try {
    const result = await invoke('measure_pixel_bounds', {
      cursorX: screenX,
      cursorY: screenY
    });

    if (result) {
      state.pixelResult = result;
      updatePixelMeasureInfo(result);
      requestDraw();
    } else {
      state.pixelResult = null;
      updatePixelMeasureInfo(null);
      requestDraw();
    }
  } catch (err) {
    console.error('像素测量失败:', err);
  }
}

// ============================================
// 坐标系切换
// ============================================

/**
 * 切换坐标系（屏幕 ↔ 窗口）
 * 窗口坐标系需要检测到目标窗口才能使用
 */
function toggleCoordSystem() {
  if (state.coordSystem === CoordSystem.SCREEN) {
    if (!state.targetWindow) {
      showToast('error', '未检测到目标窗口，无法切换到窗口坐标系');
      return;
    }
    state.coordSystem = CoordSystem.WINDOW;
    showToast('success', '已切换到窗口坐标系');
  } else {
    state.coordSystem = CoordSystem.SCREEN;
    showToast('success', '已切换到屏幕坐标系');
  }
  // 持久化坐标系选择到 localStorage
  try { localStorage.setItem('coordSystem', state.coordSystem); } catch (_) { }
  // 更新 UI 显示
  updateCoordSystemIndicator();
  updateInfoPanel();
  // 空闲状态下也更新边缘距离（坐标系切换后边缘距离会变化）
  if (state.measureState === MeasureState.IDLE && state.currentPoint) {
    const local = state.currentPoint;
    const edgeX = (state.coordSystem === CoordSystem.WINDOW && state.targetWindow)
      ? local.screenX - state.targetWindow.rect.left
      : local.x;
    const edgeY = (state.coordSystem === CoordSystem.WINDOW && state.targetWindow)
      ? local.screenY - state.targetWindow.rect.top
      : local.y;
    const baseRect = (state.coordSystem === CoordSystem.WINDOW && state.targetWindow)
      ? state.targetWindow.rect
      : { left: 0, top: 0, right: state.screenSize.width, bottom: state.screenSize.height };
    updateEdgeDistances(edgeX, edgeY, baseRect);
  }
  requestDraw();
  // 同步更新工具栏按钮文本和样式（主窗口可见时）
  if (btnCoordSystem) {
    btnCoordSystem.textContent = state.coordSystem === CoordSystem.WINDOW ? '窗口坐标系' : '屏幕坐标系';
    btnCoordSystem.classList.toggle('toolbar-btn-window-coord', state.coordSystem === CoordSystem.WINDOW);
  }
}

/**
 * 更新坐标系指示器显示
 */
function updateCoordSystemIndicator() {
  const indicator = document.getElementById('coord-system-indicator');
  if (!indicator) return;

  if (state.coordSystem === CoordSystem.WINDOW && state.targetWindow) {
    indicator.textContent = '窗口坐标系';
    indicator.className = 'coord-indicator coord-indicator-window';
  } else {
    indicator.textContent = '屏幕坐标系';
    indicator.className = 'coord-indicator coord-indicator-screen';
  }
}

// ============================================
// 数据计算
// ============================================

/**
 * 计算两点之间的欧几里得距离
 */
function getDistance(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 计算矩形宽度和高度
 */
function getRectDimensions(p1, p2) {
  return {
    width: Math.abs(p2.x - p1.x),
    height: Math.abs(p2.y - p1.y)
  };
}

/**
 * 计算点到边缘的距离（基于指定边界矩形）
 */
function getEdgeDistances(x, y, baseRect) {
  const boundsW = baseRect ? (baseRect.right - baseRect.left) : (state.screenSize.width || window.innerWidth);
  const boundsH = baseRect ? (baseRect.bottom - baseRect.top) : (state.screenSize.height || window.innerHeight);

  return {
    left: x,
    right: boundsW - x,
    top: y,
    bottom: boundsH - y
  };
}

/**
 * 计算测量区域到边缘的距离（基于指定边界矩形）
 * 返回矩形边界到四边的最小距离
 */
function getRectEdgeDistances(p1, p2, baseRect) {
  const boundsW = baseRect ? (baseRect.right - baseRect.left) : (state.screenSize.width || window.innerWidth);
  const boundsH = baseRect ? (baseRect.bottom - baseRect.top) : (state.screenSize.height || window.innerHeight);

  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);

  return {
    left: minX,
    right: boundsW - maxX,
    top: minY,
    bottom: boundsH - maxY
  };
}

// ============================================
// UI 更新
// ============================================

/**
 * 更新信息面板显示
 */
/**
 * 获取基于当前坐标系的显示坐标
 * 屏幕坐标系：返回画布坐标（相对于量尺窗口视口，等同于屏幕坐标偏移）
 * 窗口坐标系：返回相对于目标窗口左上角的坐标
 */
function getInfoPoint(p) {
  if (state.coordSystem === CoordSystem.WINDOW && state.targetWindow) {
    const r = state.targetWindow.rect;
    return {
      x: p.screenX - r.left,
      y: p.screenY - r.top
    };
  }
  // 屏幕坐标系：返回画布坐标
  return { x: p.x, y: p.y };
}

function updateInfoPanel() {
  if (state.measureState === MeasureState.IDLE) {
    resetInfoPanel();
    return;
  }

  const baseRect = (state.coordSystem === CoordSystem.WINDOW && state.targetWindow) ? state.targetWindow.rect : null;
  const p1 = getInfoPoint(state.startPoint);
  const p2 = getInfoPoint(state.endPoint);
  const dist = getDistance(state.startPoint, state.endPoint);
  const rect = getRectDimensions(state.startPoint, state.endPoint);
  const edges = getRectEdgeDistances(p1, p2, baseRect);

  setText(infoDistance, Math.round(dist) + ' px');
  setText(infoWidth, rect.width + ' px');
  setText(infoHeight, rect.height + ' px');
  setText(infoLeft, edges.left + ' px');
  setText(infoRight, edges.right + ' px');
  setText(infoTop, edges.top + ' px');
  setText(infoBottom, edges.bottom + ' px');

  // 更新收敛状态下的摘要信息
  updateInfoPanelSummary();
}

/**
 * 仅更新边缘距离（鼠标空闲移动时）
 */
function updateEdgeDistances(x, y, baseRect) {
  const edges = getEdgeDistances(x, y, baseRect);
  setText(infoLeft, edges.left + ' px');
  setText(infoRight, edges.right + ' px');
  setText(infoTop, edges.top + ' px');
  setText(infoBottom, edges.bottom + ' px');
}

/**
 * 重置信息面板
 */
function resetInfoPanel() {
  const zero = '0 px';
  setText(infoDistance, zero);
  setText(infoWidth, zero);
  setText(infoHeight, zero);
  setText(infoLeft, zero);
  setText(infoRight, zero);
  setText(infoTop, zero);
  setText(infoBottom, zero);

  // 重置摘要信息
  updateInfoPanelSummary();
}

/**
 * 安全地设置元素文本内容
 */
function setText(el, text) {
  if (el) el.textContent = text;
}

/**
 * 更新坐标跟随提示
 */
function updateCursorTooltip(posX, posY, displayX, displayY) {
  if (!cursorTooltip) return;
  if (displayX === undefined) displayX = posX;
  if (displayY === undefined) displayY = posY;

  const offset = 16;
  let left = posX + offset;
  let top = posY + offset;

  // 防止提示超出屏幕右下边界（使用缓存尺寸避免 getBoundingClientRect 重排）
  const tipW = cursorTooltip.offsetWidth || 80;
  const tipH = cursorTooltip.offsetHeight || 40;
  const screenW = window.innerWidth;
  const screenH = window.innerHeight;

  if (left + tipW > screenW) {
    left = posX - tipW - offset;
  }
  if (top + tipH > screenH) {
    top = posY - tipH - offset;
  }

  // 使用 transform 替代 left/top，避免触发重排
  cursorTooltip.style.transform = `translate(${left}px, ${top}px)`;
  cursorTooltip.classList.add('visible');
  cursorTooltip.setAttribute('aria-hidden', 'false');

  if (cursorX) cursorX.textContent = 'X: ' + displayX;
  if (cursorY) cursorY.textContent = 'Y: ' + displayY;
}

// ============================================
// Canvas 绘制
// ============================================

/** 绘制请求标记，用于 requestAnimationFrame 节流 */
let _drawRequested = false;
/** 画布是否已清空（避免空闲时反复 clearRect 导致任务栏抖动） */
let _canvasClean = false;

/**
 * 请求重绘（使用 requestAnimationFrame 节流，避免同一帧多次重绘导致闪烁）
 */
function requestDraw() {
  if (_drawRequested) return;
  _drawRequested = true;
  requestAnimationFrame(() => {
    _drawRequested = false;
    draw();
  });
}

/**
 * 主绘制函数
 */
function draw() {
  if (!ctx) return;

  const w = window.innerWidth;
  const h = window.innerHeight;

  // 判断是否有实际内容需要绘制
  const hasContent =
    (state.coordSystem === CoordSystem.WINDOW && state.targetWindow) ||
    (state.pixelMeasureMode === PixelMeasureMode.ON && state.pixelResult) ||
    state.measureState !== MeasureState.IDLE;

  // 无内容时只清空画布，避免不必要的重绘导致任务栏抖动
  if (!hasContent) {
    // 仅在画布非空时才清空（避免每帧都调用 clearRect）
    if (!_canvasClean) {
      ctx.clearRect(0, 0, w, h);
      _canvasClean = true;
    }
    return;
  }

  _canvasClean = false;
  // 清空画布
  ctx.clearRect(0, 0, w, h);

  // 仅在窗口坐标系下绘制目标窗口边框
  if (state.coordSystem === CoordSystem.WINDOW && state.targetWindow) {
    drawTargetWindowBorder();
  }

  // 绘制像素测量结果（如果处于像素测量模式且有结果）
  if (state.pixelMeasureMode === PixelMeasureMode.ON && state.pixelResult) {
    drawPixelMeasureResult();
  }

  if (state.measureState === MeasureState.IDLE) {
    return;
  }

  const p1 = state.startPoint;
  const p2 = state.endPoint;

  // 绘制测量线
  drawMeasurement(p1, p2);

  // 绘制端点标记
  drawEndpoint(p1.x, p1.y, '起点');
  drawEndpoint(p2.x, p2.y, '终点');

  // 绘制起点坐标标注
  drawCoordinateLabel(p1.x, p1.y, getInfoPoint(state.startPoint));

  // 绘制终点坐标标注
  drawCoordinateLabel(p2.x, p2.y, getInfoPoint(state.endPoint));

  // 绘制矩形框
  drawRect(p1, p2);

  // 绘制尺寸标注
  drawDimensionLabels(p1, p2);
}

/**
 * 绘制目标窗口边框（视觉反馈，让用户知道当前坐标系）
 */
function drawTargetWindowBorder() {
  if (!state.targetWindow) return;

  const rect = state.targetWindow.rect;
  // 将屏幕坐标转换为画布坐标（相对于量尺窗口视口）
  const x = rect.left - state.rulerPosition.x;
  const y = rect.top - state.rulerPosition.y;
  const w = rect.right - rect.left;
  const h = rect.bottom - rect.top;

  ctx.save();

  // 绘制窗口边框高亮
  ctx.strokeStyle = 'rgba(34, 197, 94, 0.6)';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 4]);
  ctx.strokeRect(x, y, w, h);

  // 绘制原点标记
  ctx.fillStyle = 'rgba(34, 197, 94, 0.8)';
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fill();

  // 原点标签（透明背景 + 绿色文字）
  ctx.font = '11px "Cascadia Code", Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const label = '(0, 0)';
  ctx.fillStyle = '#22c55e';
  ctx.fillText(label, x + 14, y + 13);

  ctx.restore();
}

/**
 * 绘制背景网格
 */
function drawGrid(w, h) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.lineWidth = 1;

  const gridSize = 50;

  for (let x = 0; x <= w; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  for (let y = 0; y <= h; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * 绘制像素颜色测量结果
 * 在画布上绘制同色像素区域的边界框和十字线
 */
function drawPixelMeasureResult() {
  if (!state.pixelResult) return;

  const result = state.pixelResult;
  // 将屏幕坐标转换为画布坐标
  const left = result.left - state.rulerPosition.x;
  const top = result.top - state.rulerPosition.y;
  const right = result.right - state.rulerPosition.x;
  const bottom = result.bottom - state.rulerPosition.y;
  const width = right - left;
  const height = bottom - top;
  const cursorX = result.cursor_x - state.rulerPosition.x;
  const cursorY = result.cursor_y - state.rulerPosition.y;

  ctx.save();

  // 绘制同色区域边界框
  ctx.strokeStyle = '#a855f7'; // 紫色边框
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(left, top, width, height);

  // 绘制鼠标位置十字线（贯穿整个屏幕）
  ctx.strokeStyle = 'rgba(168, 85, 247, 0.4)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);

  // 水平线
  ctx.beginPath();
  ctx.moveTo(left, cursorY);
  ctx.lineTo(right, cursorY);
  ctx.stroke();

  // 垂直线
  ctx.beginPath();
  ctx.moveTo(cursorX, top);
  ctx.lineTo(cursorX, bottom);
  ctx.stroke();

  // 绘制边界端点标记
  ctx.fillStyle = '#a855f7';

  // 左边界标记
  ctx.beginPath();
  ctx.arc(left, cursorY, 4, 0, Math.PI * 2);
  ctx.fill();

  // 右边界标记
  ctx.beginPath();
  ctx.arc(right, cursorY, 4, 0, Math.PI * 2);
  ctx.fill();

  // 上边界标记
  ctx.beginPath();
  ctx.arc(cursorX, top, 4, 0, Math.PI * 2);
  ctx.fill();

  // 下边界标记
  ctx.beginPath();
  ctx.arc(cursorX, bottom, 4, 0, Math.PI * 2);
  ctx.fill();

  // 绘制尺寸标注
  ctx.font = '12px "Cascadia Code", Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  // 宽度标注（在水平线上方，透明背景）
  const widthLabel = result.width + ' px';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = '#c084fc';
  ctx.fillText(widthLabel, cursorX, top - 6);

  // 高度标注（在垂直线右侧，透明背景）
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const heightLabel = result.height + ' px';
  ctx.fillStyle = '#c084fc';
  ctx.fillText(heightLabel, right + 12, cursorY);

  ctx.restore();
}

/**
 * 绘制测量线（两点之间的连线）
 */
function drawMeasurement(p1, p2) {
  ctx.save();

  // 主线条
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();

  // 实线边框（增强可见性）
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.3)';
  ctx.lineWidth = 4;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();

  ctx.restore();
}

/**
 * 绘制端点标记
 */
function drawEndpoint(x, y, label) {
  ctx.save();

  // 外圈
  ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.fill();

  // 内圈
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fill();

  // 十字线
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
  ctx.lineWidth = 1;
  const len = 12;

  ctx.beginPath();
  ctx.moveTo(x - len, y);
  ctx.lineTo(x + len, y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x, y - len);
  ctx.lineTo(x, y + len);
  ctx.stroke();

  ctx.restore();
}

/**
 * 绘制端点坐标标注
 * @param {number} canvasX - 画布坐标 X
 * @param {number} canvasY - 画布坐标 Y
 * @param {object} infoPoint - 坐标系对齐后的坐标 { x, y }
 */
function drawCoordinateLabel(canvasX, canvasY, infoPoint) {
  ctx.save();

  const text = '(' + Math.round(infoPoint.x) + ', ' + Math.round(infoPoint.y) + ')';
  ctx.font = '12px "Cascadia Code", Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';

  const textWidth = ctx.measureText(text).width;
  const padding = 4;
  const boxW = textWidth + padding * 2;
  const boxH = 18;
  let boxX = canvasX + 14;
  let boxY = canvasY - 10;

  // 防止超出右边界
  if (boxX + boxW > window.innerWidth) {
    boxX = canvasX - boxW - 6;
  }

  // 透明背景
  ctx.fillStyle = '#f59e0b';
  ctx.fillText(text, boxX + padding, boxY - 2);

  ctx.restore();
}

/**
 * 绘制矩形框
 */
function drawRect(p1, p2) {
  ctx.save();

  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);

  const width = maxX - minX;
  const height = maxY - minY;

  if (width < 2 || height < 2) {
    ctx.restore();
    return;
  }

  // 填充
  ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
  ctx.fillRect(minX, minY, width, height);

  // 边框
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(minX, minY, width, height);

  ctx.restore();
}

/**
 * 绘制尺寸标注
 */
function drawDimensionLabels(p1, p2) {
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);

  const width = maxX - minX;
  const height = maxY - minY;

  ctx.save();
  ctx.font = '12px "Cascadia Code", Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 宽度标注（在矩形上方或下方，透明背景）
  if (width > 0) {
    const labelY = minY > 30 ? minY - 12 : maxY + 20;
    const labelX = minX + width / 2;

    const text = width + ' px';
    ctx.fillStyle = '#f59e0b';
    ctx.fillText(text, labelX, labelY);
  }

  // 高度标注（在矩形左侧或右侧，透明背景）
  if (height > 0) {
    const labelX = minX > 50 ? minX - 8 : maxX + 8;
    const labelY = minY + height / 2;

    ctx.save();
    ctx.textAlign = minX > 50 ? 'right' : 'left';

    const text = height + ' px';
    ctx.fillStyle = '#f59e0b';
    ctx.fillText(text, labelX, labelY);
    ctx.restore();
  }

  // 距离标注（在线条中点，透明背景）
  const dist = getDistance(p1, p2);
  if (dist > 0) {
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;

    // 计算垂直偏移，避免与线重叠
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const offsetX = len > 0 ? (-dy / len) * 20 : 0;
    const offsetY = len > 0 ? (dx / len) * 20 : -20;

    const text = Math.round(dist) + ' px';
    ctx.fillStyle = '#ef4444';
    ctx.fillText(text, midX + offsetX, midY + offsetY);
  }

  ctx.restore();
}

// ============================================
// 保存功能
// ============================================

/**
 * 保存当前测量数据到剪贴板（JSON5 格式，带中文注释）
 */
async function saveMeasurement() {
  // 像素测量模式：保存十字线数据
  if (state.pixelMeasureMode === PixelMeasureMode.ON && state.pixelResult) {
    await savePixelMeasurement();
    return;
  }

  // 矩形测量模式：保存拖拽测量数据
  if (state.measureState === MeasureState.IDLE) {
    showToast('error', '没有正在进行的测量');
    return;
  }

  const baseRect = (state.coordSystem === CoordSystem.WINDOW && state.targetWindow) ? state.targetWindow.rect : null;
  const p1 = getInfoPoint(state.startPoint);
  const p2 = getInfoPoint(state.endPoint);
  const dist = Math.round(getDistance(state.startPoint, state.endPoint));
  const dim = getRectDimensions(state.startPoint, state.endPoint);
  const edges = getRectEdgeDistances(p1, p2, baseRect);

  const coordInfo = (state.coordSystem === CoordSystem.WINDOW && state.targetWindow)
    ? `coord_system: { // 坐标系信息
    type: "window",  // 坐标系：窗口
    title: "${state.targetWindow.title}",
    width: ${state.targetWindow.width},
    height: ${state.targetWindow.height},
  },`
    : `coord_system: { // 坐标系信息
    type: "screen", // 坐标系：屏幕
    width: ${state.screenSize.width},
    height: ${state.screenSize.height},
  },`;

  const json5 = `{
  // 文件格式: JSON5 格式
  // 注释: 中文注释
  // 数据: 测量数据

  
  measureMode: "rectangle",// 测量模式: 矩形测量
  ${coordInfo}
  distance: ${dist},// 两点之间的距离（像素）
  start: { x: ${p1.x}, y: ${p1.y} },// 起点坐标
  end: { x: ${p2.x}, y: ${p2.y} },// 终点坐标
  rect: { // 矩形尺寸
    width: ${dim.width},   // 宽度
    height: ${dim.height}, // 高度
  },
  distances: { // 四边到屏幕/窗口边缘的距离（像素）
    left: ${edges.left},    // 左边 → 左边缘
    right: ${edges.right},  // 右边 → 右边缘
    top: ${edges.top},      // 上边 → 上边缘
    bottom: ${edges.bottom},// 下边 → 下边缘
  }
}`;

  try {
    await invoke('write_clipboard', { text: json5 });
    triggerSaveFlash();
    showToast('success', '测量数据已复制到剪贴板');
  } catch (err) {
    console.error('保存失败:', err);
    showToast('error', '保存失败: ' + err);
  }
}

/**
 * 触发保存成功闪光效果
 */
function triggerSaveFlash() {
  if (infoPanel) infoPanel.classList.add('save-flash');
  setTimeout(() => {
    if (infoPanel) infoPanel.classList.remove('save-flash');
  }, 600);
}

/**
 * 保存十字线（像素测量）数据到剪贴板（JSON5 格式）
 */
async function savePixelMeasurement() {
  const r = state.pixelResult;
  if (!r) {
    showToast('error', '没有像素测量数据');
    return;
  }

  const [cr, cg, cb] = r.base_color;
  const hexColor = '#' + [cr, cg, cb].map(c => c.toString(16).padStart(2, '0')).join('');

  // 复用矩形测量的四边距离计算逻辑，保证完全一致
  const regionStart = {
    x: r.left - state.rulerPosition.x,
    y: r.top - state.rulerPosition.y,
    screenX: r.left,
    screenY: r.top
  };
  const regionEnd = {
    x: r.right - state.rulerPosition.x,
    y: r.bottom - state.rulerPosition.y,
    screenX: r.right,
    screenY: r.bottom
  };
  const baseRect = (state.coordSystem === CoordSystem.WINDOW && state.targetWindow) ? state.targetWindow.rect : null;
  const p1 = getInfoPoint(regionStart);
  const p2 = getInfoPoint(regionEnd);
  const edges = getRectEdgeDistances(p1, p2, baseRect);
  const leftDist = edges.left;
  const rightDist = edges.right;
  const topDist = edges.top;
  const bottomDist = edges.bottom;

  // 构建坐标系信息（与矩形测量保持一致的结构）
  const coordInfo = (state.coordSystem === CoordSystem.WINDOW && state.targetWindow)
    ? `coord_system: { // 坐标系信息
    type: "window", // 坐标系：窗口
    title: "${state.targetWindow.title}",
    width: ${state.targetWindow.width},
    height: ${state.targetWindow.height},
  },`
    : `coord_system: { // 坐标系信息
    type: "screen", // 坐标系：屏幕
    width: ${state.screenSize.width},
    height: ${state.screenSize.height},
  },`;

  // 使用模板字符串构建 JSON5（字段顺序与矩形测量保持一致）
  const json5 = `{
  // 文件格式: JSON5 格式
  // 注释: 中文注释
  // 数据: 测量数据
  
  measureMode: "crosshair",// 测量模式: 十字线测量
  ${coordInfo}
  center: { // 十字线中心坐标信息
    x: ${r.cursor_x},
    y: ${r.cursor_y},
    color: { // 十字线中心点颜色
      hex: "${hexColor}",  // 十六进制
      r: ${cr},            // Red 0-255
      g: ${cg},            // Green 0-255
      b: ${cb},            // Blue 0-255
    }
  },
  rect: { // 同色区域尺寸（像素）
    width: ${r.width},
    height: ${r.height},
  },
  distances: { // 同色区域四边到屏幕/窗口边缘的距离（像素）
    left: ${leftDist},     // 区域左边 → 左边缘
    right: ${rightDist},   // 区域右边 → 右边缘
    top: ${topDist},       // 区域上边 → 上边缘
    bottom: ${bottomDist}, // 区域下边 → 下边缘
  }
}`;

  try {
    await invoke('write_clipboard', { text: json5 });
    triggerSaveFlash();
    showToast('success', '像素测量数据已复制到剪贴板');
  } catch (err) {
    console.error('保存失败:', err);
    showToast('error', '保存失败: ' + err);
  }
}

/**
 * 截取当前测量区域的屏幕截图到剪贴板
 * 矩形测量模式：截取 startPoint 到 endPoint 包围的矩形区域
 * 十字线测量模式：截取 pixelResult 检测到的同色区域
 */
async function captureScreenshot() {
  let region;

  if (state.pixelMeasureMode === PixelMeasureMode.ON && state.pixelResult) {
    // 十字线模式：使用检测到的同色区域边界（屏幕坐标）
    const r = state.pixelResult;
    region = {
      left: Math.min(r.left, r.right),
      top: Math.min(r.top, r.bottom),
      right: Math.max(r.left, r.right),
      bottom: Math.max(r.top, r.bottom)
    };
  } else if (state.measureState !== MeasureState.IDLE && state.startPoint && state.endPoint) {
    // 矩形测量模式：使用拖拽起止点的屏幕坐标
    if (state.startPoint.screenX === undefined) {
      showToast('error', '缺少屏幕坐标信息，无法截屏');
      return;
    }
    region = {
      left: Math.min(state.startPoint.screenX, state.endPoint.screenX),
      top: Math.min(state.startPoint.screenY, state.endPoint.screenY),
      right: Math.max(state.startPoint.screenX, state.endPoint.screenX),
      bottom: Math.max(state.startPoint.screenY, state.endPoint.screenY)
    };
  } else {
    showToast('error', '没有正在进行的测量，无法截屏');
    return;
  }

  try {
    await invoke('capture_region_to_clipboard', {
      left: region.left,
      top: region.top,
      right: region.right,
      bottom: region.bottom
    });
    triggerSaveFlash();
    showToast('success', '屏幕截图已复制到剪贴板');
  } catch (err) {
    console.error('截屏失败:', err);
    showToast('error', '截屏失败: ' + err);
  }
}

// ============================================
// 退出量尺模式
// ============================================

/**
 * 退出量尺覆盖层
 */
async function exitRulerMode() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  try {
    // 先显示工具栏（此时 ruler 窗口仍存活，IPC 正常）
    await invoke('show_main_window');
    // 再关闭 ruler 窗口
    await invoke('close_ruler_window');
  } catch (err) {
    console.error('退出量尺失败:', err);
  }
}

// ============================================
// 提示消息
// ============================================

/**
 * 显示操作结果提示
 * @param {'success'|'error'} type 提示类型
 * @param {string} message 提示消息
 */
function showToast(type, message) {
  if (!saveToast || !saveToastIcon || !saveToastMessage) return;

  // 清除之前的定时器，避免提前隐藏
  if (saveToast._hideTimer) {
    clearTimeout(saveToast._hideTimer);
  }

  saveToast.className = 'save-toast ' + type + ' show';
  saveToastIcon.textContent = type === 'success' ? '✓' : '✗';
  saveToastMessage.textContent = message;
  saveToast.setAttribute('role', 'alert');
  saveToast.setAttribute('aria-live', 'assertive');

  // 2秒后自动隐藏
  saveToast._hideTimer = setTimeout(() => {
    if (saveToast) {
      saveToast.className = 'save-toast';
      saveToast.setAttribute('aria-live', 'off');
      saveToast._hideTimer = null;
    }
  }, 2000);
}

// ============================================
// 启动
// ============================================

window.addEventListener('DOMContentLoaded', init);
