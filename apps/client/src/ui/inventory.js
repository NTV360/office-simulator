const HOTBAR_SIZE = 3;

/** Small owner-only inventory UI. State is always read from the authoritative Mirror person. */
export function initInventoryUI({ getPerson, send, isJoined }) {
  const panel = document.createElement('section');
  panel.id = 'inventoryPanel';
  panel.className = 'card inventory-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Inventory');
  panel.innerHTML = '<strong>Inventory</strong><div class="inventory-grid" role="grid"></div><div class="inventory-hotbar" aria-label="Hotbar"></div><small>Drag an item out to drop it. Drag an item onto a hotbar slot to assign it.</small>';
  document.body.append(panel);
  const grid = panel.querySelector('.inventory-grid');
  const hotbar = panel.querySelector('.inventory-hotbar');
  let selected = null;

  const sendAction = (action, fields = {}) => {
    const person = getPerson();
    if (!person || !isJoined()) return;
    const revision = person.mechanics?.inventoryRevision ?? 0;
    send({ type: 'inventory', action, revision, ...fields });
  };

  function itemEl(item) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'inventory-item';
    el.draggable = true;
    el.textContent = item.type;
    el.title = `${item.type} (${item.id})`;
    el.dataset.itemId = item.id;
    el.addEventListener('click', () => { selected = item.id; render(); });
    el.addEventListener('dragstart', e => {
      e.dataTransfer?.setData('text/plain', item.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    return el;
  }

  function render() {
    const person = getPerson();
    const inventory = person?.inventory;
    panel.hidden = !person || !inventory;
    if (!inventory) return;
    grid.replaceChildren();
    for (const item of inventory.items) {
      const el = itemEl(item);
      el.style.gridColumn = `${item.x + 1} / span 1`;
      el.style.gridRow = `${item.y + 1} / span 1`;
      if (item.id === selected) el.classList.add('selected');
      grid.append(el);
    }
    hotbar.replaceChildren();
    for (let slot = 0; slot < HOTBAR_SIZE; slot++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'inventory-slot';
      cell.textContent = inventory.hotbar[slot] ?? `Slot ${slot + 1}`;
      cell.addEventListener('dragover', e => { e.preventDefault(); cell.classList.add('drag-over'); });
      cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
      cell.addEventListener('drop', e => {
        e.preventDefault(); cell.classList.remove('drag-over');
        const id = e.dataTransfer?.getData('text/plain');
        if (id) sendAction('hotbar', { slot, itemId: id });
      });
      hotbar.append(cell);
    }
  }

  panel.addEventListener('dragover', e => e.preventDefault());
  panel.addEventListener('drop', e => {
    if (e.target.closest('.inventory-slot')) return;
    e.preventDefault();
    const id = e.dataTransfer?.getData('text/plain');
    if (id) sendAction('drop', { itemId: id });
  });
  return { render };
}
