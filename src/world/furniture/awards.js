import * as THREE from 'three';
import { TAU, shuffle } from '../../core/util.js';
import { fullName, jobTitle, roster } from '../../people/roster.js';
import { people } from '../../sim/state.js';

// The TV lounge's screen while nobody is gaming (main.js): a joke award and a random winner from the whole staff
// list, a new one every 15 seconds. Department awards only go to people in that department (interns included),
// the intern awards only to interns. Accounts without a department (admins) never win.
const EVERYONE = ['Best OOTD 👗', 'Employee of the Century', 'Jira Champion of All Time', 'Keyboard Shortcut Master of All Time'];
const DEV = ['"It Works on My Machine" Lifetime Achievement', 'Survived a Merge Conflict and Lived to Tell the Tale', 'Most Likely to Say "That\'s a Frontend Problem"', 'Fixed a Bug, Made Three More', 'Commit Message: "fix" Award'];
const FRONT = ['Finally Centered the Div 🏆', 'Most Likely to Say "That\'s a Backend Problem"', 'console.log("here") Debugger of the Year', 'Clear Cache and Hard Refresh Expert', '47 Chrome Tabs and Still Standing'];
const BY_DEPARTMENT = {
  'Software Development': DEV, 'Backend': DEV,
  'Frontend (FE)': FRONT, 'Website Development': FRONT,
  'UI/UX': ['Moved It 1px Left, Then 1px Right', 'Figma Layer Named "Rectangle 284" Award', '"Can We Make It Pop More?" Survivor', 'Most Sticky Notes on a Single Wall', 'Dark Mode Missionary'],
  'Graphics Design': ['"Make the Logo Bigger" Survivor', 'Final_Final_v7_REAL.psd Award', 'Can Tell #FFFFFF from #FEFEFE', 'Comic Sans Bodyguard', 'Ctrl+Z Speedrun World Record'],
  'Quality Assurance': ['Found a Bug in the Bug Fix', '"Works as Intended?" Skeptic of the Month', 'Clicked Every Button Twice Just Because', 'The Developers\' Favorite Nightmare', 'Tested on Internet Explorer, For Fun'],
  'Research and Development': ['Asked ChatGPT First, Then Google', '"Let\'s Try a New Framework" Award', 'Prototype Held Together by Hope', 'Read the Docs (Rare Achievement)'],
  'Internet of Things (IoT)': ['Has Tried Turning It Off and On Again', 'Most Wires Per Square Meter', 'The Arduino Whisperer', 'Blinked an LED and Felt Like a God'],
  'Project Management': ['"Quick 5-Minute Call" Specialist (40 mins)', 'Moved the Deadline With Their Mind', 'Most Jira Tickets Created Per Hour', 'Fluent in "Let\'s Circle Back"', 'Gantt Chart Picasso'],
  'Human Resources': ['Knows Everyone\'s Birthday by Heart', 'Official Office Party Mastermind', 'Free Food Announcement Hero', 'Has the Paperwork for That'],
};
const INTERNS = ['Intern of the Month 🌟', 'Asked "Is This Paid?" Bravely', 'Survived Their First Code Review', 'Pushed to Main by Accident (Once)', 'Most Enthusiastic "Yes, I Can Do That!"', 'Googles Faster Than They Type'];
const EVERY = 15000; // ms between awards

// Every award with who can win it.
const AWARDS = [
  ...EVERYONE.map(title => ({ title, can: () => true })),
  ...Object.entries(BY_DEPARTMENT).flatMap(([dept, titles]) => titles.map(title => ({ title, can: e => e.department === dept }))),
  ...INTERNS.map(title => ({ title, can: e => e.intern })),
];

const show = { mat: null, ctx: null, tex: null, bag: [], next: 0 };

// The staff who can win: the staff list without the accounts that have no department. Without the list (API
// down), the made-up people in the office, for the awards everyone can win.
function staff() {
  if (roster.list) return roster.list.filter(e => e.department).map(e => ({ ...e, name: fullName(e), title: jobTitle(e) }));
  return people.filter(p => !p.helper).map(p => ({ name: p.name, title: p.title ?? p.role, department: null, intern: false }));
}
// The next award (all of them in a shuffled order, then again) with a winner who fits it.
function nextAward() {
  const who = staff();
  for (let tries = 0; tries < AWARDS.length * 2; tries++) {
    if (!show.bag.length) show.bag = shuffle(AWARDS.slice());
    const a = show.bag.pop(), fits = who.filter(a.can);
    if (fits.length) return { title: a.title, winner: fits[Math.floor(Math.random() * fits.length)] };
  }
  return null;
}

// Text in at most two lines no wider than `w`, shrinking the font from `size` until it fits.
function fitText(g, text, x, y, w, size, weight, lineGap = 1.15) {
  for (let s = size; s >= 12; s -= 2) {
    g.font = `${weight} ${s}px Archivo, "Helvetica Neue", Arial, sans-serif`;
    const words = text.split(' '), lines = [''];
    for (const word of words) { const t = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${word}` : word; if (g.measureText(t).width <= w) lines[lines.length - 1] = t; else lines.push(word); }
    if (lines.length <= 2 && lines.every(l => g.measureText(l).width <= w)) {
      lines.forEach((l, i) => g.fillText(l, x, y + (i - (lines.length - 1) / 2) * s * lineGap));
      return;
    }
  }
}
function draw(award) {
  const g = show.ctx, { width: w, height: h } = g.canvas;
  const bg = g.createLinearGradient(0, 0, w, h); bg.addColorStop(0, '#1b1f3a'); bg.addColorStop(1, '#3b1f4a');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  // confetti
  const colors = ['#f2d14a', '#e83e9b', '#5ab5ff', '#9ad19a', '#ffffff'];
  for (let i = 0; i < 70; i++) { g.fillStyle = colors[i % colors.length]; g.globalAlpha = .55; g.save(); g.translate(Math.random() * w, Math.random() * h); g.rotate(Math.random() * TAU); g.fillRect(-4, -1.5, 8, 3); g.restore(); }
  g.globalAlpha = 1;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#f2d14a'; g.font = '700 15px Archivo, "Helvetica Neue", Arial, sans-serif';
  if ('letterSpacing' in g) g.letterSpacing = '4px';
  g.fillText('🏆  NTV360 OFFICE AWARDS  🏆', w / 2, 30);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  if (!award) return;
  g.fillStyle = '#f2d14a'; fitText(g, award.title, w / 2, 98, w - 50, 34, 800);
  g.fillStyle = 'rgba(255,255,255,.65)'; g.font = '500 14px Archivo, "Helvetica Neue", Arial, sans-serif'; g.fillText('goes to', w / 2, 150);
  g.fillStyle = '#ffffff'; fitText(g, award.winner.name, w / 2, 192, w - 60, 40, 800);
  g.fillStyle = 'rgba(255,255,255,.6)'; g.font = '600 13px Archivo, "Helvetica Neue", Arial, sans-serif';
  if ('letterSpacing' in g) g.letterSpacing = '2px';
  g.fillText(award.winner.title.toUpperCase(), w / 2, 238);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  g.fillStyle = 'rgba(255,255,255,.45)'; g.font = '500 11px Archivo, "Helvetica Neue", Arial, sans-serif'; g.fillText('Congratulations! 🎉', w / 2, 266);
  show.tex.needsUpdate = true;
}

// The awards screen's material, moving on to the next award every 15 seconds (call it every frame it shows).
function awardsScreen(now = performance.now()) {
  if (!show.mat) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 288;
    show.ctx = c.getContext('2d');
    show.tex = new THREE.CanvasTexture(c); show.tex.colorSpace = THREE.SRGBColorSpace;
    show.mat = new THREE.MeshBasicMaterial({ map: show.tex, toneMapped: false });
    document.fonts?.ready.then(() => { show.next = 0; }); // redraw once the web font is in
  }
  if (now >= show.next) { show.next = now + EVERY; draw(nextAward()); }
  return show.mat;
}

export { awardsScreen };
