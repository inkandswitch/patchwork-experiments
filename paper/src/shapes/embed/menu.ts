export type MenuItem = { id: string; name: string };

const MENU_CSS = [
  'position:fixed',
  'z-index:99999',
  'background:#fff',
  'border:1px solid #ddd',
  'border-radius:8px',
  'box-shadow:0 4px 16px rgba(0,0,0,0.15)',
  'padding:4px',
  'min-width:160px',
  'font:13px/1.4 system-ui,sans-serif',
].join(';');

const ITEM_CSS = [
  'display:flex',
  'align-items:center',
  'width:100%',
  'padding:6px 10px',
  'border:none',
  'background:none',
  'border-radius:5px',
  'cursor:pointer',
  'text-align:left',
  'font:inherit',
  'box-sizing:border-box',
].join(';');

export function openMenu(
  anchorEl: HTMLElement,
  items: MenuItem[],
  onSelect: (id: string) => void,
): () => void {
  const menu = document.createElement('div');
  menu.style.cssText = MENU_CSS;

  for (const item of items) {
    const row = document.createElement('button');
    row.style.cssText = ITEM_CSS;
    row.textContent = item.name;
    row.addEventListener('mouseover', () => {
      row.style.background = '#f0f0f0';
    });
    row.addEventListener('mouseout', () => {
      row.style.background = '';
    });
    row.addEventListener('pointerdown', (e) => e.stopPropagation());
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      onSelect(item.id);
      close();
    });
    menu.appendChild(row);
  }

  menu.style.visibility = 'hidden';
  document.body.appendChild(menu);
  const rect = anchorEl.getBoundingClientRect();
  const menuH = menu.offsetHeight;
  const menuW = menu.offsetWidth;
  menu.style.left = `${Math.min(rect.left, window.innerWidth - menuW - 8)}px`;
  menu.style.top = `${rect.top - menuH - 4}px`;
  menu.style.visibility = '';

  function close() {
    menu.remove();
    document.removeEventListener('pointerdown', onOutside);
  }

  function onOutside(e: PointerEvent) {
    if (!menu.contains(e.target as Node)) close();
  }
  setTimeout(() => document.addEventListener('pointerdown', onOutside), 0);

  return close;
}
