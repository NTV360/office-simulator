// A person's avatar: their profile picture (employees.metadata.profileImage), or their initials on their shirt
// colour when there is none or it fails to load.
const initials = name => name.split(/\s+/).filter(w => /^\p{L}/u.test(w)).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
// Dark or light text, whichever reads better on the colour.
function inkOn(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#1b1f24' : '#ffffff';
}
// Fill `el` (a round box) for `who`: { name, photo, color }.
function fillAvatar(el, who) {
  const showInitials = () => { el.replaceChildren(initials(who.name)); el.style.background = who.color; el.style.color = inkOn(who.color); el.classList.remove('has-photo'); };
  if (!who.photo) { showInitials(); return; }
  const img = new Image(); img.alt = ''; img.referrerPolicy = 'no-referrer'; img.decoding = 'async';
  img.onerror = showInitials;
  img.src = who.photo;
  el.replaceChildren(img); el.style.background = 'var(--chip)'; el.classList.add('has-photo');
}

export { fillAvatar, initials };
