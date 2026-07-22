(function(){
  const grid = document.getElementById('pixelGrid');
  const canvasWrap = document.querySelector('.canvas-wrap');
  const appTitle = document.querySelector('.app-title');
  const footer = document.querySelector('.footer');
  const resizeHandle = document.getElementById('resizeHandle');
  const colorPicker = document.getElementById('colorPicker');
  const colorLabel = document.getElementById('colorLabel');
  const palette = document.getElementById('palette');
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  const lockToggle = document.getElementById('lockToggle');
  const lockOverlay = document.getElementById('lockOverlay');
  const applySizeBtn = document.getElementById('applySize');
  const clearAllBtn = document.getElementById('clearAll');
  const inputCols = document.getElementById('inputCols');
  const inputRows = document.getElementById('inputRows');
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importInput = document.getElementById('importInput');
  const exportPngBtn = document.getElementById('exportPngBtn');
  const saveStatus = document.getElementById('saveStatus');

  const STORAGE_KEY = 'pixelArtStudio:autosave';

  let cols = 16, rows = 16;
  let pixelCells = [];
  let currentColor = colorPicker.value;
  let currentTool = 'pen';
  let isPointerDown = false;
  let isLocked = false;
  let isResizingFooter = false;

  let history = [];
  let historyIndex = -1;
  let HISTORY_LIMIT = 60;

  let PRESET_COLORS = [
    '#000000','#ffffff','#8a8a9c','#ff5d8f','#ff9f5d','#ffe45d',
    '#7ee8c1','#5dc9ff','#5d7bff','#b25dff','#ff5d5d','#5dffb2',
    '#c98a4b','#2f2f3a','#ffd1e6','#d1fff0'
  ];

  /* ---------- config.json (tùy chỉnh không cần sửa code) ---------- */
  async function loadConfig(){
    try{
      const res = await fetch('config.json', {cache:'no-store'});
      if(!res.ok) throw new Error('bad response');
      const data = await res.json();
      if(Array.isArray(data.presetColors) && data.presetColors.length) PRESET_COLORS = data.presetColors;
      if(Number.isFinite(data.defaultCols)) cols = data.defaultCols;
      if(Number.isFinite(data.defaultRows)) rows = data.defaultRows;
      if(Number.isFinite(data.historyLimit)) HISTORY_LIMIT = data.historyLimit;
    } catch(err){
      // Không tải được config.json (vd: mở file trực tiếp bằng file://) -> dùng giá trị mặc định có sẵn.
      console.warn('Không tải được config.json, dùng cấu hình mặc định.', err);
    }
  }

  /* ---------- palette ---------- */
  function buildPalette(){
    palette.innerHTML = '';
    PRESET_COLORS.forEach(color => {
      const sw = document.createElement('button');
      sw.className = 'swatch';
      sw.style.background = color;
      sw.type = 'button';
      sw.addEventListener('click', () => setColor(color));
      palette.appendChild(sw);
    });
  }

  function setColor(color){
    currentColor = color;
    colorPicker.value = color;
    colorLabel.textContent = color.toUpperCase();
  }

  colorPicker.addEventListener('input', e => setColor(e.target.value));

  /* ---------- grid build & layout ---------- */
  function buildGrid(c, r, initialColors){
    cols = Math.max(1, Math.min(64, c | 0 || 1));
    rows = Math.max(1, Math.min(64, r | 0 || 1));

    grid.innerHTML = '';
    pixelCells = [];

    const frag = document.createDocumentFragment();

    const corner = document.createElement('div');
    corner.className = 'header-cell header-corner';
    frag.appendChild(corner);

    for(let c2 = 0; c2 < cols; c2++){
      const h = document.createElement('div');
      h.className = 'header-cell header-col';
      h.textContent = c2 + 1;
      frag.appendChild(h);
    }

    for(let r2 = 0; r2 < rows; r2++){
      const rh = document.createElement('div');
      rh.className = 'header-cell header-row';
      rh.textContent = r2 + 1;
      frag.appendChild(rh);

      for(let c2 = 0; c2 < cols; c2++){
        const idx = r2 * cols + c2;
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.index = idx;
        const initColor = (initialColors && initialColors[idx]) ? initialColors[idx] : '';
        cell.dataset.color = initColor;
        if(initColor) cell.style.backgroundColor = initColor;
        frag.appendChild(cell);
        pixelCells.push(cell);
      }
    }

    grid.appendChild(frag);
    layoutGrid();
    resetHistory();
  }

  function layoutGrid(){
    const availW = canvasWrap.clientWidth - 8;
    const availH = canvasWrap.clientHeight - 8;

    const roughCell = Math.max(3, Math.floor(Math.min(availW / (cols + 1), availH / (rows + 1))));
    const headerSize = Math.max(16, Math.min(30, roughCell));
    const cellSize = Math.max(3, Math.floor(Math.min((availW - headerSize) / cols, (availH - headerSize) / rows)));

    grid.style.gridTemplateColumns = `${headerSize}px repeat(${cols}, ${cellSize}px)`;
    grid.style.gridTemplateRows = `${headerSize}px repeat(${rows}, ${cellSize}px)`;
    grid.style.width = (headerSize + cellSize * cols) + 'px';
    grid.style.height = (headerSize + cellSize * rows) + 'px';

    const fontSize = Math.min(11, Math.max(6, cellSize * 0.5)) + 'px';
    grid.querySelectorAll('.header-cell').forEach(el => {
      el.style.fontSize = fontSize;
    });
  }

  function updateFooterHeightLimits(){
    const maxH = Math.round(window.innerHeight * 0.75);
    if(footer.getBoundingClientRect().height > maxH){
      footer.style.height = maxH + 'px';
    }
  }

  window.addEventListener('resize', () => {
    updateFooterHeightLimits();
    layoutGrid();
  });

  /* ---------- undo / redo ---------- */
  function snapshot(){
    return pixelCells.map(c => c.dataset.color);
  }

  function resetHistory(){
    history = [snapshot()];
    historyIndex = 0;
    updateHistoryButtons();
  }

  function pushHistory(){
    const snap = snapshot();
    if(historyIndex >= 0 && snap.join('|') === history[historyIndex].join('|')) return;
    history = history.slice(0, historyIndex + 1);
    history.push(snap);
    if(history.length > HISTORY_LIMIT) history.shift();
    historyIndex = history.length - 1;
    updateHistoryButtons();
  }

  function restoreState(state){
    for(let i = 0; i < pixelCells.length; i++){
      const color = state[i] || '';
      pixelCells[i].style.backgroundColor = color;
      pixelCells[i].dataset.color = color;
    }
  }

  function undo(){
    if(historyIndex <= 0) return;
    historyIndex--;
    restoreState(history[historyIndex]);
    updateHistoryButtons();
  }

  function redo(){
    if(historyIndex >= history.length - 1) return;
    historyIndex++;
    restoreState(history[historyIndex]);
    updateHistoryButtons();
  }

  function updateHistoryButtons(){
    undoBtn.disabled = isLocked || historyIndex <= 0;
    redoBtn.disabled = isLocked || historyIndex >= history.length - 1;
    saveToStorage();
  }

  /* ---------- autosave (localStorage) ---------- */
  function saveToStorage(){
    try{
      const data = {
        cols, rows,
        colors: pixelCells.map(c => c.dataset.color),
        locked: isLocked
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      if(saveStatus){
        const time = new Date().toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
        saveStatus.textContent = '💾 Đã lưu tự động lúc ' + time;
      }
    } catch(err){
      if(saveStatus){
        saveStatus.textContent = '⚠ Trình duyệt chặn lưu tự động — hãy dùng "Xuất file" để sao lưu thủ công.';
      }
    }
  }

  function loadFromStorage(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return null;
      const data = JSON.parse(raw);
      if(!data || !data.cols || !data.rows || !Array.isArray(data.colors)) return null;
      return data;
    } catch(err){
      return null;
    }
  }

  /* ---------- lock ---------- */
  function updateLockState(){
    applySizeBtn.disabled = isLocked;
    clearAllBtn.disabled = isLocked;
    inputCols.disabled = isLocked;
    inputRows.disabled = isLocked;
    colorPicker.disabled = isLocked;
    document.querySelectorAll('.tool-btn').forEach(btn => btn.disabled = isLocked);
    document.querySelectorAll('.swatch').forEach(sw => sw.disabled = isLocked);
    grid.classList.toggle('locked', isLocked);
    lockOverlay.classList.toggle('show', isLocked);
    updateHistoryButtons();
  }

  lockToggle.addEventListener('change', e => {
    isLocked = e.target.checked;
    updateLockState();
  });

  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);

  document.addEventListener('keydown', e => {
    const activeTag = document.activeElement && document.activeElement.tagName;
    if(activeTag === 'INPUT') return;
    const key = e.key.toLowerCase();
    if((e.ctrlKey || e.metaKey) && !e.shiftKey && key === 'z'){ e.preventDefault(); undo(); }
    else if((e.ctrlKey || e.metaKey) && (key === 'y' || (e.shiftKey && key === 'z'))){ e.preventDefault(); redo(); }
  });

  /* ---------- painting ---------- */
  function paintCell(cell){
    if(!cell || !cell.classList.contains('cell')) return;
    if(currentTool === 'pen'){
      cell.style.backgroundColor = currentColor;
      cell.dataset.color = currentColor;
    } else if(currentTool === 'eraser'){
      cell.style.backgroundColor = '';
      cell.dataset.color = '';
    } else if(currentTool === 'picker'){
      if(cell.dataset.color){
        setColor(cell.dataset.color);
        setTool('pen');
      }
    } else if(currentTool === 'fill'){
      floodFill(cell);
    }
  }

  function floodFill(startCell){
    const target = startCell.dataset.color;
    if(target === currentColor) return;
    const cells = pixelCells;
    const startIdx = parseInt(startCell.dataset.index, 10);
    const stack = [startIdx];
    const visited = new Set();

    while(stack.length){
      const idx = stack.pop();
      if(visited.has(idx)) continue;
      visited.add(idx);
      const cell = cells[idx];
      if(cell.dataset.color !== target) continue;

      cell.style.backgroundColor = currentColor;
      cell.dataset.color = currentColor;

      const row = Math.floor(idx / cols), col = idx % cols;
      if(col > 0) stack.push(idx - 1);
      if(col < cols - 1) stack.push(idx + 1);
      if(row > 0) stack.push(idx - cols);
      if(row < rows - 1) stack.push(idx + cols);
    }
  }

  function cellFromPoint(x, y){
    const el = document.elementFromPoint(x, y);
    return el && el.classList.contains('cell') ? el : null;
  }

  grid.addEventListener('mousedown', e => {
    if(isLocked) return;
    isPointerDown = true;
    paintCell(e.target);
  });
  grid.addEventListener('mouseover', e => {
    if(isLocked || !isPointerDown) return;
    paintCell(e.target);
  });
  document.addEventListener('mouseup', () => {
    if(isPointerDown){ isPointerDown = false; pushHistory(); }
  });

  grid.addEventListener('touchstart', e => {
    if(isLocked) return;
    isPointerDown = true;
    const t = e.touches[0];
    paintCell(cellFromPoint(t.clientX, t.clientY));
  }, {passive:true});
  grid.addEventListener('touchmove', e => {
    if(isLocked || !isPointerDown) return;
    const t = e.touches[0];
    paintCell(cellFromPoint(t.clientX, t.clientY));
  }, {passive:true});
  document.addEventListener('touchend', () => {
    if(isPointerDown){ isPointerDown = false; pushHistory(); }
  });

  /* ---------- resize footer (kéo viền) ---------- */
  let footerDragStartY = 0;
  let footerDragStartH = 0;

  function startFooterResize(clientY){
    isResizingFooter = true;
    footerDragStartY = clientY;
    footerDragStartH = footer.getBoundingClientRect().height;
    resizeHandle.classList.add('dragging');
  }
  function moveFooterResize(clientY){
    if(!isResizingFooter) return;
    const deltaY = clientY - footerDragStartY;
    let newHeight = footerDragStartH - deltaY;
    const minH = 120;
    const maxH = Math.round(window.innerHeight * 0.75);
    newHeight = Math.max(minH, Math.min(maxH, newHeight));
    footer.style.height = newHeight + 'px';
    layoutGrid();
  }
  function endFooterResize(){
    if(!isResizingFooter) return;
    isResizingFooter = false;
    resizeHandle.classList.remove('dragging');
    document.body.style.userSelect = '';
  }

  resizeHandle.addEventListener('mousedown', e => {
    e.preventDefault();
    document.body.style.userSelect = 'none';
    startFooterResize(e.clientY);
  });
  document.addEventListener('mousemove', e => moveFooterResize(e.clientY));
  document.addEventListener('mouseup', endFooterResize);

  resizeHandle.addEventListener('touchstart', e => {
    startFooterResize(e.touches[0].clientY);
  }, {passive:true});
  document.addEventListener('touchmove', e => {
    if(!isResizingFooter) return;
    moveFooterResize(e.touches[0].clientY);
  }, {passive:true});
  document.addEventListener('touchend', endFooterResize);

  function initFooterHeight(){
    const titleH = appTitle.offsetHeight;
    const target = Math.round((window.innerHeight - titleH) * 0.2);
    footer.style.height = Math.max(120, target) + 'px';
  }

  /* ---------- tools ---------- */
  function setTool(tool){
    currentTool = tool;
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
  }
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });

  clearAllBtn.addEventListener('click', () => {
    if(isLocked) return;
    pixelCells.forEach(cell => {
      cell.style.backgroundColor = '';
      cell.dataset.color = '';
    });
    pushHistory();
  });

  /* ---------- canvas size ---------- */
  applySizeBtn.addEventListener('click', () => {
    if(isLocked) return;
    const c = parseInt(inputCols.value, 10);
    const r = parseInt(inputRows.value, 10);
    buildGrid(c, r);
  });

  /* ---------- export / import file ---------- */
  exportBtn.addEventListener('click', () => {
    const data = {
      cols, rows,
      colors: pixelCells.map(c => c.dataset.color)
    };
    const blob = new Blob([JSON.stringify(data)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pixel-art-' + Date.now() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  importBtn.addEventListener('click', () => {
    if(isLocked) return;
    importInput.click();
  });

  importInput.addEventListener('change', e => {
    const file = e.target.files[0];
    importInput.value = '';
    if(!file || isLocked) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try{
        const data = JSON.parse(evt.target.result);
        if(!data.cols || !data.rows || !Array.isArray(data.colors)) throw new Error('invalid');
        inputCols.value = data.cols;
        inputRows.value = data.rows;
        buildGrid(data.cols, data.rows, data.colors);
      } catch(err){
        alert('File không hợp lệ, vui lòng chọn đúng file .json đã xuất từ công cụ này.');
      }
    };
    reader.readAsText(file);
  });

  /* ---------- export PNG (kèm số hàng / cột) ---------- */
  exportPngBtn.addEventListener('click', () => {
    const CELL_PX = 32;
    const RULER_TOP_PX = 30;
    const RULER_LEFT_PX = 40;

    const BG = '#24242f';
    const LINE = '#34343f';
    const TEXT = '#c7c7d6';
    const CHECK_A = '#232330';
    const CHECK_B = '#2a2a35';

    const canvas = document.createElement('canvas');
    canvas.width = RULER_LEFT_PX + cols * CELL_PX;
    canvas.height = RULER_TOP_PX + rows * CELL_PX;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cellsArr = pixelCells;
    for(let i = 0; i < cellsArr.length; i++){
      const row = Math.floor(i / cols), col = i % cols;
      const x = RULER_LEFT_PX + col * CELL_PX;
      const y = RULER_TOP_PX + row * CELL_PX;
      const color = cellsArr[i].dataset.color;
      if(color){
        ctx.fillStyle = color;
        ctx.fillRect(x, y, CELL_PX, CELL_PX);
      } else {
        const half = CELL_PX / 2;
        ctx.fillStyle = CHECK_A;
        ctx.fillRect(x, y, CELL_PX, CELL_PX);
        ctx.fillStyle = CHECK_B;
        ctx.fillRect(x, y, half, half);
        ctx.fillRect(x + half, y + half, half, half);
      }
      ctx.strokeStyle = 'rgba(52,52,63,0.6)';
      ctx.strokeRect(x + 0.5, y + 0.5, CELL_PX - 1, CELL_PX - 1);
    }

    ctx.font = 'bold 13px Arial, sans-serif';
    ctx.fillStyle = TEXT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for(let c = 0; c < cols; c++){
      const cx = RULER_LEFT_PX + c * CELL_PX + CELL_PX / 2;
      ctx.fillText(String(c + 1), cx, RULER_TOP_PX / 2);
      ctx.strokeStyle = LINE;
      ctx.beginPath();
      ctx.moveTo(RULER_LEFT_PX + c * CELL_PX + 0.5, 0);
      ctx.lineTo(RULER_LEFT_PX + c * CELL_PX + 0.5, RULER_TOP_PX);
      ctx.stroke();
    }
    for(let r = 0; r < rows; r++){
      const cy = RULER_TOP_PX + r * CELL_PX + CELL_PX / 2;
      ctx.fillText(String(r + 1), RULER_LEFT_PX / 2, cy);
      ctx.strokeStyle = LINE;
      ctx.beginPath();
      ctx.moveTo(0, RULER_TOP_PX + r * CELL_PX + 0.5);
      ctx.lineTo(RULER_LEFT_PX, RULER_TOP_PX + r * CELL_PX + 0.5);
      ctx.stroke();
    }

    ctx.strokeStyle = LINE;
    ctx.beginPath();
    ctx.moveTo(RULER_LEFT_PX + 0.5, 0);
    ctx.lineTo(RULER_LEFT_PX + 0.5, canvas.height);
    ctx.moveTo(0, RULER_TOP_PX + 0.5);
    ctx.lineTo(canvas.width, RULER_TOP_PX + 0.5);
    ctx.stroke();
    ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);

    canvas.toBlob(blob => {
      if(!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pixel-art-' + Date.now() + '.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 'image/png');
  });

  /* ---------- tabs ---------- */
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
    });
  });

  /* ---------- init ---------- */
  async function init(){
    await loadConfig();
    inputCols.value = cols;
    inputRows.value = rows;

    initFooterHeight();
    buildPalette();
    setColor(currentColor);

    const saved = loadFromStorage();
    if(saved){
      inputCols.value = saved.cols;
      inputRows.value = saved.rows;
      buildGrid(saved.cols, saved.rows, saved.colors);
      if(saved.locked){
        lockToggle.checked = true;
        isLocked = true;
        updateLockState();
      }
    } else {
      buildGrid(cols, rows);
    }
  }

  init();
})();
