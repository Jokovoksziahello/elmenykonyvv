(() => {
  'use strict';

  const STORAGE_KEY = 'emlek-konyv-v1';
  const BLANK_COLOR = '#fffdf9';
  const createPage = () => ({ id: makeId(), background: BLANK_COLOR, elements: [] });
  const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const initialState = () => ({ pages: Array.from({ length: 10 }, createPage), currentPage: 0 });

  let state = initialState();
  let selectedId = null;
  let zoom = 100;
  let undoStack = [];
  let redoStack = [];
  let saveTimer = 0;
  let toastTimer = 0;
  let dragState = null;
  let previewPageIndex = 0;
  let textEditSnapshot = null;
  let rotationEditSnapshot = null;
  let fontSizeEditSnapshot = null;
  let colorEditSnapshot = null;
  let backgroundEditSnapshot = null;

  const $ = (id) => document.getElementById(id);
  const pageList = $('page-list');
  const bookPage = $('book-page');
  const previewPage = $('preview-page');
  const stateWithoutSelection = () => JSON.stringify(state);

  function showToast(message) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2600);
  }

  function scheduleSave() {
    const status = $('save-status');
    status.classList.add('saving');
    status.lastChild.textContent = ' Mentés…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        status.classList.remove('saving');
        status.lastChild.textContent = ' Mentve';
      } catch (error) {
        status.classList.remove('saving');
        status.lastChild.textContent = ' Nem menthető';
        showToast('A böngésző tárhelye megtelt. Mentsd fájlba a könyvedet.');
        console.error('Az automatikus mentés nem sikerült:', error);
      }
    }, 350);
  }

  function recordHistory() {
    pushHistorySnapshot(stateWithoutSelection());
    scheduleSave();
  }

  function pushHistorySnapshot(snapshot) {
    undoStack.push(snapshot);
    if (undoStack.length > 80) undoStack.shift();
    redoStack = [];
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    $('undo-btn').disabled = undoStack.length === 0;
    $('redo-btn').disabled = redoStack.length === 0;
  }

  function restoreSnapshot(from, to) {
    if (!from.length) return;
    to.push(stateWithoutSelection());
    state = JSON.parse(from.pop());
    selectedId = null;
    render();
    updateHistoryButtons();
    scheduleSave();
  }

  function getCurrentPage() {
    return state.pages[state.currentPage];
  }

  function findElement(id) {
    return getCurrentPage()?.elements.find((element) => element.id === id) || null;
  }

  function makePageMarkup(page, target, editable = false) {
    target.replaceChildren();
    target.style.backgroundColor = page.background;
    for (const element of page.elements) {
      const node = document.createElement(element.type === 'image' ? 'img' : 'div');
      node.className = `page-element ${element.type}-element${editable && element.id === selectedId ? ' selected' : ''}`;
      node.dataset.id = element.id;
      node.style.left = `${element.x}%`;
      node.style.top = `${element.y}%`;
      node.style.width = `${element.w}%`;
      node.style.height = `${element.h}%`;
      node.style.transform = `rotate(${element.rotation || 0}deg)`;
      if (element.type === 'text') {
        node.textContent = element.text;
        node.style.fontFamily = element.font || 'Georgia, serif';
        node.style.fontSize = `${element.fontSize || 24}px`;
        node.style.color = element.color || '#35312e';
      } else if (element.type === 'image') {
        node.src = element.src;
        node.alt = '';
        node.draggable = false;
        node.style.objectFit = element.fit || 'contain';
      } else {
        node.textContent = element.symbol;
        node.style.color = element.color || '#a57d67';
        node.style.fontSize = `${element.fontSize || 54}px`;
      }
      if (editable) {
        node.addEventListener('pointerdown', onElementPointerDown);
        node.addEventListener('click', (event) => {
          event.stopPropagation();
          selectElement(element.id);
        });
      }
      target.appendChild(node);
    }
  }

  function renderThumbnails() {
    pageList.replaceChildren();
    state.pages.forEach((page, index) => {
      const item = document.createElement('div');
      item.className = `page-thumb${index === state.currentPage ? ' active' : ''}`;
      item.setAttribute('role', 'group');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-label', `${index + 1}. oldal`);
      const paper = document.createElement('div');
      paper.className = 'thumb-paper';
      paper.style.backgroundColor = page.background;
      const copy = document.createElement('div');
      copy.className = 'thumb-copy';
      const name = document.createElement('span');
      name.className = 'thumb-name';
      name.textContent = ` ${index + 1}. oldal`;
      const meta = document.createElement('span');
      meta.className = 'thumb-meta';
      meta.textContent = `${page.elements.length} elem`;
      copy.append(name, meta);
      const controls = document.createElement('div');
      controls.className = 'thumb-controls';
      const up = document.createElement('button');
      up.type = 'button';
      up.textContent = '↑';
      up.title = 'Oldal mozgatása felfelé';
      up.disabled = index === 0;
      up.addEventListener('click', (event) => { event.stopPropagation(); movePage(index, -1); });
      const down = document.createElement('button');
      down.type = 'button';
      down.textContent = '↓';
      down.title = 'Oldal mozgatása lefelé';
      down.disabled = index === state.pages.length - 1;
      down.addEventListener('click', (event) => { event.stopPropagation(); movePage(index, 1); });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = 'Oldal törlése';
      remove.disabled = state.pages.length <= 1;
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        if (state.pages.length <= 1) return;
        if (!confirm(`${index + 1}. oldal törlése? Ez a művelet a rajta lévő elemeket is eltávolítja.`)) return;
        recordHistory();
        state.pages.splice(index, 1);
        if (state.currentPage > index) state.currentPage -= 1;
        else if (state.currentPage === index) state.currentPage = Math.min(index, state.pages.length - 1);
        selectedId = null;
        render();
      });
      controls.append(up, down, remove);
      item.append(paper, copy, controls);
      item.addEventListener('click', () => changePage(index));
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); changePage(index); }
      });
      pageList.appendChild(item);
    });
    $('page-count').textContent = state.pages.length;
  }

  function renderInspector() {
    const element = findElement(selectedId);
    $('empty-inspector').hidden = Boolean(element);
    $('element-inspector').hidden = !element;
    if (!element) {
      $('page-background-control').value = getCurrentPage().background;
      $('background-value').textContent = getCurrentPage().background;
      return;
    }
    $('element-type-title').textContent = element.type === 'text' ? 'Szöveg' : element.type === 'image' ? 'Fénykép' : 'Matrica';
    $('text-controls').hidden = element.type !== 'text';
    $('image-controls').hidden = element.type !== 'image';
    $('sticker-controls').hidden = element.type !== 'sticker';
    $('element-width').value = Math.round(element.w);
    $('element-height').value = Math.round(element.h);
    $('element-rotation').value = element.rotation || 0;
    $('rotation-value').textContent = `${element.rotation || 0}°`;
    if (element.type === 'text') {
      $('element-text').value = element.text;
      $('font-family').value = element.font || 'Georgia, serif';
      $('font-size').value = element.fontSize || 24;
      $('font-size-value').textContent = `${element.fontSize || 24} px`;
      $('text-color').value = element.color || '#35312e';
      $('text-color-value').textContent = element.color || '#35312e';
    } else if (element.type === 'image') {
      $('image-fit').value = element.fit || 'contain';
    } else {
      $('sticker-color').value = element.color || '#a57d67';
      $('sticker-color-value').textContent = element.color || '#a57d67';
    }
  }

  function renderLayers() {
    const panel = $('layers-panel');
    const elements = getCurrentPage().elements;
    panel.replaceChildren();
    panel.hidden = elements.length === 0;
    if (!elements.length) return;
    const heading = document.createElement('div');
    heading.className = 'layers-heading';
    heading.textContent = 'ELEMEK AZ OLDALON';
    panel.appendChild(heading);
    const counts = { text: 0, image: 0, sticker: 0 };
    elements.slice().reverse().forEach((element) => {
      counts[element.type] += 1;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `layer-item${element.id === selectedId ? ' active' : ''}`;
      const symbol = document.createElement('span');
      symbol.className = 'layer-symbol';
      symbol.textContent = element.type === 'text' ? 'T' : element.type === 'image' ? '▧' : '✳';
      const name = document.createElement('span');
      name.textContent = `${element.type === 'text' ? 'Szöveg' : element.type === 'image' ? 'Fénykép' : 'Matrica'} ${counts[element.type]}`;
      item.append(symbol, name);
      item.addEventListener('click', () => selectElement(element.id));
      panel.appendChild(item);
    });
  }

  function render() {
    const page = getCurrentPage();
    makePageMarkup(page, bookPage, true);
    bookPage.style.transform = `scale(${zoom / 100})`;
    $('zoom-label').textContent = `${zoom}%`;
    $('page-indicator').textContent = `${state.currentPage + 1} / ${state.pages.length}`;
    $('prev-btn').disabled = state.currentPage === 0;
    $('next-btn').disabled = state.currentPage === state.pages.length - 1;
    renderThumbnails();
    renderLayers();
    renderInspector();
    $('background-color').value = page.background;
    updateHistoryButtons();
  }

  function selectElement(id) {
    selectedId = id;
    render();
  }

  function changePage(index) {
    if (index < 0 || index >= state.pages.length) return;
    selectedId = null;
    state.currentPage = index;
    render();
  }

  function movePage(index, offset) {
    const destination = index + offset;
    if (destination < 0 || destination >= state.pages.length) return;
    recordHistory();
    const [page] = state.pages.splice(index, 1);
    state.pages.splice(destination, 0, page);
    if (state.currentPage === index) state.currentPage = destination;
    else if (index < state.currentPage && destination >= state.currentPage) state.currentPage -= 1;
    else if (index > state.currentPage && destination <= state.currentPage) state.currentPage += 1;
    render();
  }

  function addElement(element) {
    recordHistory();
    getCurrentPage().elements.push({ id: makeId(), x: 14, y: 17, w: 72, h: 20, rotation: 0, ...element });
    selectedId = getCurrentPage().elements.at(-1).id;
    render();
  }

  function onElementPointerDown(event) {
    if (event.button !== 0) return;
    const id = event.currentTarget.dataset.id;
    selectedId = id;
    event.currentTarget.classList.add('selected');
    renderInspector();
    const element = findElement(id);
    const rect = bookPage.getBoundingClientRect();
    dragState = { id, pointerX: event.clientX, pointerY: event.clientY, x: element.x, y: element.y, width: rect.width, height: rect.height, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.addEventListener('pointermove', onElementPointerMove);
    event.currentTarget.addEventListener('pointerup', onElementPointerUp, { once: true });
    event.currentTarget.addEventListener('pointercancel', onElementPointerUp, { once: true });
  }

  function onElementPointerMove(event) {
    if (!dragState) return;
    const element = findElement(dragState.id);
    if (!element) return;
    const dx = (event.clientX - dragState.pointerX) / dragState.width * 100;
    const dy = (event.clientY - dragState.pointerY) / dragState.height * 100;
    if (Math.abs(dx) + Math.abs(dy) > .3) dragState.moved = true;
    const x = Math.max(0, Math.min(100 - element.w, dragState.x + dx));
    const y = Math.max(0, Math.min(100 - element.h, dragState.y + dy));
    const node = bookPage.querySelector(`[data-id="${CSS.escape(element.id)}"]`);
    if (node) { node.style.left = `${x}%`; node.style.top = `${y}%`; }
    element.x = x;
    element.y = y;
  }

  function onElementPointerUp(event) {
    event.currentTarget.removeEventListener('pointermove', onElementPointerMove);
    if (dragState?.moved) {
      const movedElement = findElement(dragState.id);
      if (movedElement) {
        const finalX = movedElement.x;
        const finalY = movedElement.y;
        movedElement.x = dragState.x;
        movedElement.y = dragState.y;
        recordHistory();
        movedElement.x = finalX;
        movedElement.y = finalY;
        render();
      }
    }
    dragState = null;
  }

  function changeElement(update) {
    const element = findElement(selectedId);
    if (!element) return;
    recordHistory();
    Object.assign(element, update);
    render();
  }

  async function loadImageFile(file, type) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Kérlek, képfájlt válassz.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => showToast('A képfájlt nem sikerült beolvasni.');
    reader.onload = () => {
      const src = String(reader.result);
      if (type === 'replace') {
        const element = findElement(selectedId);
        if (!element || element.type !== 'image') return;
        recordHistory();
        element.src = src;
        render();
      } else {
        const image = new Image();
        image.onload = () => {
          const ratio = image.naturalWidth / image.naturalHeight || 1;
          const w = Math.min(76, 48 * ratio);
          const h = Math.min(62, 48 / ratio);
          addElement({ type: 'image', src, fit: 'contain', x: (100 - w) / 2, y: (100 - h) / 2, w, h });
        };
        image.onerror = () => showToast('A kiválasztott kép nem tölthető be.');
        image.src = src;
      }
    };
    reader.readAsDataURL(file);
  }

  function fileDownload(name, contents, type) {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function compressToBase64Url(value) {
    const bytes = new TextEncoder().encode(value);
    if (!('CompressionStream' in window)) {
      return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < compressed.length; offset += 0x8000) {
      binary += String.fromCharCode(...compressed.subarray(offset, offset + 0x8000));
    }
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  }

  async function decodeFromBase64Url(value) {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    if (!('DecompressionStream' in window)) return new TextDecoder().decode(bytes);
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
      return await new Response(stream).text();
    } catch {
      return new TextDecoder().decode(bytes);
    }
  }

  async function shareBook() {
    let link;
    try {
      const encoded = await compressToBase64Url(JSON.stringify(state));
      if (encoded.length > 1_500_000) {
        showToast('A könyv túl nagy egy megosztható linkhez. Mentsd fájlba, vagy csökkentsd a képek méretét.');
        return;
      }
      link = `${location.href.split('#')[0]}#book=${encoded}`;
      await navigator.clipboard.writeText(link);
      showToast('A könyv linkje a vágólapra került. Aki megkapja, meg tudja nyitni.');
    } catch (error) {
      if (!link) {
        console.error('A megosztási hivatkozás létrehozása nem sikerült:', error);
        showToast('Nem sikerült létrehozni a megosztási linket.');
        return;
      }
      const copiedManually = prompt('A vágólap nem érhető el. Másold ki a megosztási linket:', link);
      if (copiedManually !== null) showToast('A link kimásolható. Külső megosztáshoz a weboldalnak elérhető tárhelyen kell futnia.');
    }
  }

  function setPreview(index) {
    previewPageIndex = Math.max(0, Math.min(index, state.pages.length - 1));
    makePageMarkup(state.pages[previewPageIndex], previewPage, false);
    $('preview-page-indicator').textContent = `${previewPageIndex + 1} / ${state.pages.length}`;
    $('preview-prev').disabled = previewPageIndex === 0;
    $('preview-next').disabled = previewPageIndex === state.pages.length - 1;
  }

  function buildPrintDocument() {
    const root = $('print-book');
    root.replaceChildren();
    state.pages.forEach((page) => {
      const sheet = document.createElement('section');
      sheet.className = 'print-page';
      sheet.style.backgroundColor = page.background;
      page.elements.forEach((element) => {
        const node = document.createElement('div');
        node.className = 'print-element';
        node.style.left = `${element.x}%`;
        node.style.top = `${element.y}%`;
        node.style.width = `${element.w}%`;
        node.style.height = `${element.h}%`;
        node.style.transform = `rotate(${element.rotation || 0}deg)`;
        if (element.type === 'image') {
          const image = document.createElement('img');
          image.src = element.src;
          image.alt = '';
          image.style.objectFit = element.fit || 'contain';
          node.appendChild(image);
        } else if (element.type === 'text') {
          node.textContent = element.text;
          node.style.fontFamily = element.font || 'Georgia, serif';
          node.style.fontSize = `${element.fontSize || 24}px`;
          node.style.color = element.color || '#35312e';
        } else {
          node.textContent = element.symbol;
          node.style.color = element.color || '#a57d67';
          node.style.fontSize = `${element.fontSize || 54}px`;
          node.style.display = 'grid';
          node.style.placeItems = 'center';
        }
        sheet.appendChild(node);
      });
      root.appendChild(sheet);
    });
  }

  function normalizeProjectObject(project) {
    if (!project || typeof project !== 'object' || !Array.isArray(project.pages)) return project;

    if (project.pages.every((page) => page && Array.isArray(page.elements))) {
      return project;
    }

    return {
      ...project,
      pages: project.pages.map((page) => {
        if (!page || Array.isArray(page.elements)) return page;

        const themeBackgrounds = {
          pink: '#fdf1ef',
          rose: '#f7e6ea',
          beige: '#f6efe7',
          cream: '#fffdf9',
          blue: '#edf5ff',
          mint: '#edf9f5',
          lavender: '#f3eefc',
          gold: '#f7f0de'
        };

        const background = typeof page.theme === 'string' && themeBackgrounds[page.theme]
          ? themeBackgrounds[page.theme]
          : BLANK_COLOR;

        const elements = [];
        const pushText = (text, options = {}) => {
          if (typeof text !== 'string' || !text.trim()) return;
          elements.push({
            id: makeId(),
            type: 'text',
            text,
            x: clamp(options.x ?? 10, 0, 100, 10),
            y: clamp(options.y ?? 10, 0, 100, 10),
            w: clamp(options.w ?? 82, 5, 100, 82),
            h: clamp(options.h ?? 28, 3, 100, 28),
            rotation: 0,
            font: typeof options.font === 'string' ? options.font : 'Georgia, serif',
            fontSize: clamp(options.fontSize ?? 24, 10, 72, 24),
            color: /^#[0-9a-f]{6}$/i.test(options.color) ? options.color : '#35312e'
          });
        };

        if (typeof page.title === 'string' && page.title.trim()) {
          pushText(page.title, { x: 8, y: 10, w: 84, h: 12, fontSize: 30, color: '#4f403b' });
        }
        if (typeof page.text === 'string' && page.text.trim()) {
          pushText(page.text, { x: 12, y: 22, w: 76, h: 50, fontSize: 20, color: '#3f3631' });
        }

        if (typeof page.decoration === 'string' && page.decoration.trim()) {
          elements.push({
            id: makeId(),
            type: 'sticker',
            symbol: page.decoration.trim().slice(0, 4),
            x: 78,
            y: 9,
            w: 14,
            h: 10,
            rotation: 0,
            color: '#a57d67',
            fontSize: 40
          });
        }

        if (Array.isArray(page.photos)) {
          page.photos.forEach((photo, index) => {
            if (!photo || typeof photo.src !== 'string' || !photo.src) return;
            const width = clamp(Number(photo.width) || 56, 10, 90, 56);
            const height = clamp(Number(photo.height) || 42, 10, 90, 42);
            const column = index % 2;
            const row = Math.floor(index / 2);
            elements.push({
              id: makeId(),
              type: 'image',
              src: photo.src,
              x: clamp(10 + column * 48, 0, 100, 10),
              y: clamp(10 + row * 44, 0, 100, 10),
              w: width,
              h: height,
              rotation: 0,
              fit: 'contain'
            });
          });
        }

        return { id: typeof page.id === 'string' ? page.id : makeId(), background, elements };
      })
    };
  }

  function loadProjectObject(project) {
    const normalized = normalizeProjectObject(project);
    if (!normalized || !Array.isArray(normalized.pages) || normalized.pages.length < 1 ||
        normalized.pages.some((page) => !page || !Array.isArray(page.elements))) {
      throw new Error('Érvénytelen emlékkönyv fájl.');
    }
    state = {
      pages: normalized.pages.map((page) => ({
        id: typeof page.id === 'string' ? page.id : makeId(),
        background: /^#[0-9a-f]{6}$/i.test(page.background) ? page.background : BLANK_COLOR,
        elements: page.elements.filter((element) => element && ['text', 'image', 'sticker'].includes(element.type)).map((element) => ({
          id: typeof element.id === 'string' ? element.id : makeId(),
          type: element.type,
          x: clamp(element.x, 0, 100, 14), y: clamp(element.y, 0, 100, 17),
          w: clamp(element.w, 5, 100, 72), h: clamp(element.h, 3, 100, 20),
          rotation: clamp(element.rotation, -180, 180, 0),
          ...(element.type === 'text' ? {
            text: typeof element.text === 'string' ? element.text : '',
            font: typeof element.font === 'string' ? element.font : 'Georgia, serif',
            fontSize: clamp(element.fontSize, 10, 72, 24),
            color: /^#[0-9a-f]{6}$/i.test(element.color) ? element.color : '#35312e'
          } : element.type === 'image' ? {
            src: typeof element.src === 'string' ? element.src : '',
            fit: element.fit === 'cover' ? 'cover' : 'contain'
          } : {
            symbol: typeof element.symbol === 'string' ? element.symbol : '✦',
            color: /^#[0-9a-f]{6}$/i.test(element.color) ? element.color : '#a57d67',
            fontSize: clamp(element.fontSize, 10, 120, 54)
          })
        }))
      })),
      currentPage: Math.max(0, Math.min(normalized.currentPage || 0, normalized.pages.length - 1))
    };
    selectedId = null;
    undoStack = [];
    redoStack = [];
    render();
    scheduleSave();
  }

  function clamp(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }

  function loadSharedLink() {
    const match = location.hash.match(/^#book=(.+)$/);
    if (!match) return;
    decodeFromBase64Url(match[1]).then((json) => {
      loadProjectObject(JSON.parse(json));
      showToast('A megosztott emlékkönyv megnyílt. A saját változtatásaid külön mentődnek.');
    }).catch((error) => {
      console.error('A megosztott könyv betöltése nem sikerült:', error);
      showToast('A megosztási link sérült vagy nem olvasható.');
    });
  }

  $('add-page-btn').addEventListener('click', () => {
    recordHistory();
    state.pages.splice(state.currentPage + 1, 0, createPage());
    state.currentPage += 1;
    selectedId = null;
    render();
  });
  $('prev-btn').addEventListener('click', () => changePage(state.currentPage - 1));
  $('next-btn').addEventListener('click', () => changePage(state.currentPage + 1));
  $('add-text-btn').addEventListener('click', () => addElement({ type: 'text', text: '', font: 'Georgia, serif', fontSize: 24, color: '#35312e' }));
  $('add-photo-btn').addEventListener('click', () => { $('photo-input').dataset.mode = 'add'; $('photo-input').click(); });
  $('add-element-btn').addEventListener('click', () => $('custom-image-input').click());
  $('add-sticker-btn').addEventListener('click', () => {
    const symbol = prompt('Válassz egy matricát: ✦  ♥  ❋  ✿  ☼  ♡  ◇  ★');
    if (symbol === null) return;
    const trimmed = symbol.trim();
    if (!trimmed) return;
    addElement({ type: 'sticker', symbol: trimmed.slice(0, 4), color: '#a57d67', fontSize: 54, w: 22, h: 18 });
  });
  function updateBackgroundColor(event) {
    if (backgroundEditSnapshot === null) backgroundEditSnapshot = stateWithoutSelection();
    const color = event.target.value;
    getCurrentPage().background = color;
    bookPage.style.backgroundColor = color;
    const thumbnail = pageList.children[state.currentPage]?.querySelector('.thumb-paper');
    if (thumbnail) thumbnail.style.backgroundColor = color;
    $('background-value').textContent = color;
    scheduleSave();
  }
  function commitBackgroundColor() {
    if (backgroundEditSnapshot !== null && backgroundEditSnapshot !== stateWithoutSelection()) pushHistorySnapshot(backgroundEditSnapshot);
    backgroundEditSnapshot = null;
  }
  $('background-color').addEventListener('input', updateBackgroundColor);
  $('background-color').addEventListener('change', commitBackgroundColor);
  $('page-background-control').addEventListener('input', updateBackgroundColor);
  $('page-background-control').addEventListener('change', commitBackgroundColor);
  $('element-text').addEventListener('input', (event) => {
    const element = findElement(selectedId);
    if (!element) return;
    if (textEditSnapshot === null) textEditSnapshot = stateWithoutSelection();
    element.text = event.target.value;
    const node = bookPage.querySelector(`[data-id="${CSS.escape(element.id)}"]`);
    if (node) node.textContent = element.text;
    scheduleSave();
  });
  $('element-text').addEventListener('focus', () => { textEditSnapshot = stateWithoutSelection(); });
  $('element-text').addEventListener('change', () => {
    if (textEditSnapshot !== null && textEditSnapshot !== stateWithoutSelection()) pushHistorySnapshot(textEditSnapshot);
    textEditSnapshot = null;
    scheduleSave();
  });
  $('font-family').addEventListener('change', (event) => changeElement({ font: event.target.value }));
  $('font-size').addEventListener('input', (event) => {
    if (fontSizeEditSnapshot === null) fontSizeEditSnapshot = stateWithoutSelection();
    const size = Number(event.target.value);
    $('font-size-value').textContent = `${size} px`;
    const element = findElement(selectedId);
    if (!element) return;
    element.fontSize = size;
    const node = bookPage.querySelector(`[data-id="${CSS.escape(element.id)}"]`);
    if (node) node.style.fontSize = `${size}px`;
    scheduleSave();
  });
  $('font-size').addEventListener('change', () => {
    if (fontSizeEditSnapshot !== null && fontSizeEditSnapshot !== stateWithoutSelection()) pushHistorySnapshot(fontSizeEditSnapshot);
    fontSizeEditSnapshot = null;
  });
  $('text-color').addEventListener('input', (event) => {
    if (colorEditSnapshot === null) colorEditSnapshot = stateWithoutSelection();
    $('text-color-value').textContent = event.target.value;
    const element = findElement(selectedId);
    if (!element) return;
    element.color = event.target.value;
    const node = bookPage.querySelector(`[data-id="${CSS.escape(element.id)}"]`);
    if (node) node.style.color = event.target.value;
    scheduleSave();
  });
  $('text-color').addEventListener('change', () => {
    if (colorEditSnapshot !== null && colorEditSnapshot !== stateWithoutSelection()) pushHistorySnapshot(colorEditSnapshot);
    colorEditSnapshot = null;
  });
  $('sticker-color').addEventListener('input', (event) => {
    $('sticker-color-value').textContent = event.target.value;
    if (colorEditSnapshot === null) colorEditSnapshot = stateWithoutSelection();
    const element = findElement(selectedId);
    if (!element) return;
    element.color = event.target.value;
    const node = bookPage.querySelector(`[data-id="${CSS.escape(element.id)}"]`);
    if (node) node.style.color = event.target.value;
    scheduleSave();
  });
  $('sticker-color').addEventListener('change', () => {
    if (colorEditSnapshot !== null && colorEditSnapshot !== stateWithoutSelection()) pushHistorySnapshot(colorEditSnapshot);
    colorEditSnapshot = null;
  });
  $('image-fit').addEventListener('change', (event) => changeElement({ fit: event.target.value }));
  $('element-width').addEventListener('change', (event) => changeElement({ w: clamp(event.target.value, 5, 100, 50) }));
  $('element-height').addEventListener('change', (event) => changeElement({ h: clamp(event.target.value, 3, 100, 20) }));
  $('element-rotation').addEventListener('input', (event) => {
    if (rotationEditSnapshot === null) rotationEditSnapshot = stateWithoutSelection();
    const rotation = Number(event.target.value);
    $('rotation-value').textContent = `${rotation}°`;
    const element = findElement(selectedId);
    if (!element) return;
    element.rotation = rotation;
    const node = bookPage.querySelector(`[data-id="${CSS.escape(element.id)}"]`);
    if (node) node.style.transform = `rotate(${rotation}deg)`;
    scheduleSave();
  });
  $('element-rotation').addEventListener('change', () => {
    if (rotationEditSnapshot !== null && rotationEditSnapshot !== stateWithoutSelection()) pushHistorySnapshot(rotationEditSnapshot);
    rotationEditSnapshot = null;
  });
  $('delete-element-btn').addEventListener('click', () => {
    const page = getCurrentPage();
    recordHistory();
    page.elements = page.elements.filter((element) => element.id !== selectedId);
    selectedId = null;
    render();
  });
  $('duplicate-btn').addEventListener('click', () => {
    const element = findElement(selectedId);
    if (element) {
      const { id, ...copy } = element;
      addElement({ ...copy, x: Math.min(100 - element.w, element.x + 4), y: Math.min(100 - element.h, element.y + 4) });
    }
  });
  $('deselect-btn').addEventListener('click', () => { selectedId = null; render(); });
  $('replace-image-btn').addEventListener('click', () => { $('photo-input').dataset.mode = 'replace'; $('photo-input').click(); });
  $('photo-input').addEventListener('change', (event) => {
    loadImageFile(event.target.files[0], event.target.dataset.mode || 'add');
    event.target.value = '';
  });
  $('custom-image-input').addEventListener('change', (event) => {
    loadImageFile(event.target.files[0], 'add');
    event.target.value = '';
  });
  $('undo-btn').addEventListener('click', () => restoreSnapshot(undoStack, redoStack));
  $('redo-btn').addEventListener('click', () => restoreSnapshot(redoStack, undoStack));
  $('zoom-out').addEventListener('click', () => { zoom = Math.max(60, zoom - 10); render(); });
  $('zoom-in').addEventListener('click', () => { zoom = Math.min(130, zoom + 10); render(); });
  $('preview-btn').addEventListener('click', () => {
    $('preview-overlay').hidden = false;
    setPreview(state.currentPage);
  });
  $('close-preview-btn').addEventListener('click', () => { $('preview-overlay').hidden = true; });
  $('preview-prev').addEventListener('click', () => setPreview(previewPageIndex - 1));
  $('preview-next').addEventListener('click', () => setPreview(previewPageIndex + 1));
  function exportPdf() {
    buildPrintDocument();
    $('preview-overlay').hidden = true;
    setTimeout(() => window.print(), 50);
  }

  $('export-pdf-btn').addEventListener('click', exportPdf);
  $('share-btn').addEventListener('click', shareBook);
  $('save-project-btn').addEventListener('click', () => {
    const payload = { version: 2, savedAt: Date.now(), currentPage: state.currentPage, pages: state.pages };
    fileDownload('emlekkonyv.json', JSON.stringify(payload, null, 2), 'application/json');
    showToast('A könyv szerkeszthető fájlként elmentve.');
  });
  $('import-btn').addEventListener('click', () => $('project-input').click());
  $('project-input').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => showToast('A fájl nem olvasható.');
    reader.onload = () => {
      try {
        loadProjectObject(JSON.parse(String(reader.result)));
        showToast('A könyv betöltve.');
      } catch (error) {
        console.error('A könyv betöltése nem sikerült:', error);
        showToast('Ez a fájl nem érvényes emlékkönyv.');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  });
  bookPage.addEventListener('pointerdown', (event) => {
    if (event.target === bookPage) {
      selectedId = null;
      render();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') $('preview-overlay').hidden = true;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      restoreSnapshot(undoStack, redoStack);
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      restoreSnapshot(redoStack, undoStack);
    } else if ($('preview-overlay').hidden && event.key === 'ArrowLeft') changePage(state.currentPage - 1);
    else if ($('preview-overlay').hidden && event.key === 'ArrowRight') changePage(state.currentPage + 1);
  });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && event.target === $('element-text')) {
      event.stopImmediatePropagation();
    }
  }, true);
  window.addEventListener('beforeunload', () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (error) { console.error('Kilépés előtti mentés nem sikerült:', error); }
  });
  window.addEventListener('hashchange', loadSharedLink);

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) loadProjectObject(JSON.parse(saved));
  } catch (error) {
    console.error('A helyi emlékkönyv betöltése nem sikerült:', error);
    showToast('A korábbi mentést nem sikerült betölteni.');
  }
  render();
  loadSharedLink();
})();
