// Preset library. Every entry is a plain config for `new BlockyCharacter(THREE, preset)`.
// Mix and match: spread a preset and override parts, e.g.
//   { ...PRESETS.student, body: 'female', hair: { style: 'bun', color: '#1f1a18' } }
import { DEFAULT_MALE, DEFAULT_FEMALE, SKIN_TONES as S, HAIR_COLORS as H, EYE_COLORS as E } from './blocky-character.js';

export const PRESETS = {
  defaultMale: DEFAULT_MALE,
  defaultFemale: DEFAULT_FEMALE,

  briefcaseWalker: {
    name: 'Briefcase Walker', body: 'male', skin: S.fair,
    hair: { style: 'quiff', color: H.ginger }, facialHair: { style: 'beard' },
    top: { style: 'jacket', color: '#b3213d' }, bottom: { style: 'widePants', color: '#3b1714' },
    shoes: { style: 'sneakers', color: '#b32642' }, accessories: ['watch', 'briefcase'],
  },
  skater: {
    name: 'Skater', body: 'male', build: 'skinny', skin: S.tan,
    hair: { style: 'short', color: H.black },
    top: { style: 'hoodie', color: '#2f8f8f' }, bottom: { style: 'shorts', color: '#c7b28a' },
    shoes: { style: 'hightops', color: '#2a2a2e' },
    accessories: [{ type: 'beanie', color: '#e0a23a' }, 'skateboard'],
  },
  hoverRider: {
    name: 'Hover Rider', body: 'female', skin: S.medium,
    hair: { style: 'mohawk', color: H.pink },
    top: { style: 'jacket', color: '#2d2d33', accent: '#37d6ff' }, bottom: { style: 'leggings', color: '#1f2230' },
    shoes: { style: 'boots', color: '#e8ecf2' }, accessories: ['sunglasses', 'hoverboard'],
  },
  musician: {
    name: 'Musician', body: 'male', build: 'average', height: 'tall', skin: S.olive,
    hair: { style: 'long', color: H.darkBrown }, facialHair: { style: 'goatee' },
    top: { style: 'jacket', color: '#1f1f22', accent: '#d64545' }, bottom: { style: 'jeans', color: '#2f4e7a' },
    shoes: { style: 'boots', color: '#3b2a20' }, accessories: ['guitar'],
  },
  student: {
    name: 'Student', body: 'female', build: 'skinny', height: 'short', skin: S.porcelain, freckles: true,
    eyes: E.green, hair: { style: 'pigtails', color: H.auburn },
    top: { style: 'sweater', color: '#e8d6a8', accent: '#3a6ea5' }, bottom: { style: 'skirt', color: '#3a3f5c' },
    shoes: { style: 'simple', color: '#3b2a20' }, accessories: ['glasses', 'backpack', 'book'],
  },
  coffeeLover: {
    name: 'Coffee Lover', body: 'female', skin: S.light,
    hair: { style: 'bob', color: H.blonde },
    top: { style: 'longsleeve', color: '#a3b18a' }, bottom: { style: 'jeans', color: '#41608f' },
    shoes: { style: 'sneakers', color: '#f2ece2', accent: '#c9473f' },
    accessories: [{ type: 'scarf', color: '#c9473f' }, 'coffee'],
  },
  developer: {
    name: 'Developer', body: 'male', build: 'chubby', skin: S.brown,
    hair: { style: 'afro', color: H.black }, facialHair: { style: 'stubble' },
    top: { style: 'hoodie', color: '#3b3f4a' }, bottom: { style: 'joggers', color: '#2a2a2e' },
    shoes: { style: 'sneakers', color: '#e8e8ea', accent: '#2a2a2e' }, accessories: ['headphones', 'tablet'],
  },
  designer: {
    name: 'Designer', body: 'female', height: 'tall', skin: S.dark,
    hair: { style: 'bun', color: H.black }, eyes: E.dark,
    top: { style: 'longsleeve', color: '#f2ece2' }, bottom: { style: 'widePants', color: '#2d2d33' },
    shoes: { style: 'simple', color: '#d64545' }, accessories: ['glasses', 'earrings', 'tablet'],
  },
  runner: {
    name: 'Runner', body: 'male', build: 'skinny', height: 'tall', skin: S.deep,
    hair: { style: 'buzz', color: H.black },
    top: { style: 'tanktop', color: '#e86f3a' }, bottom: { style: 'shorts', color: '#1f2230' },
    shoes: { style: 'sneakers', color: '#37d6ff', accent: '#ffffff' },
    accessories: [{ type: 'headphones', color: '#f2f2f2', accent: '#37d6ff' }, 'watch'],
  },
  executive: {
    name: 'Executive', body: 'female', skin: S.fair,
    hair: { style: 'bun', color: H.darkBrown },
    top: { style: 'jacket', color: '#2f3d6e' }, bottom: { style: 'skirt', color: '#2f3d6e' },
    shoes: { style: 'simple', color: '#1d1d22' }, accessories: ['earrings', 'phone', 'watch'],
  },
  grandpa: {
    name: 'Grandpa', body: 'male', build: 'chubby', height: 'short', skin: S.light,
    hair: { style: 'none' }, facialHair: { style: 'moustache', color: H.white },
    top: { style: 'sweater', color: '#7a5a3a', accent: '#c9a76a' }, bottom: { style: 'pants', color: '#5b5b5b' },
    shoes: { style: 'simple', color: '#3b2a20' }, accessories: [{ type: 'cap', color: '#5c6b4a' }, 'glasses', 'book'],
  },
  grandma: {
    name: 'Grandma', body: 'female', build: 'chubby', height: 'short', skin: S.fair,
    hair: { style: 'bun', color: H.grey },
    top: { style: 'dress', color: '#8a5ad8', accent: '#f2ece2' }, bottom: { style: 'bare' },
    shoes: { style: 'simple', color: '#5e3b24' }, accessories: ['glasses', 'coffee'],
  },
  dj: {
    name: 'DJ', body: 'male', skin: S.dark,
    hair: { style: 'short', color: H.black }, facialHair: { style: 'beard', color: H.black },
    top: { style: 'tshirt', color: '#8a5ad8' }, bottom: { style: 'joggers', color: '#1f1f22', accent: '#8a5ad8' },
    shoes: { style: 'hightops', color: '#f2f2f2', accent: '#8a5ad8' },
    accessories: [{ type: 'cap', color: '#1f1f22' }, 'headphones', 'sunglasses'],
  },
  hiker: {
    name: 'Hiker', body: 'female', build: 'average', skin: S.tan,
    hair: { style: 'ponytail', color: H.brown },
    top: { style: 'tshirt', color: '#d9653b' }, bottom: { style: 'shorts', color: '#5c6b4a' },
    shoes: { style: 'boots', color: '#6b4a2e' }, accessories: [{ type: 'cap', color: '#3f7a5a' }, 'backpack', 'watch'],
  },
  officeWorker: {
    name: 'Office Worker', body: 'male', build: 'average', height: 'tall', skin: S.porcelain,
    hair: { style: 'short', color: H.blonde }, eyes: E.blue,
    top: { style: 'longsleeve', color: '#eef2f7' }, bottom: { style: 'pants', color: '#2d2d33' },
    shoes: { style: 'simple', color: '#3b2a20' }, accessories: ['tie', 'glasses', 'phone'],
  },
  teen: {
    name: 'Teen', body: 'female', build: 'skinny', height: 'short', skin: S.olive,
    hair: { style: 'pigtails', color: H.blue },
    top: { style: 'hoodie', color: '#e86fa3' }, bottom: { style: 'jeans', color: '#41608f' },
    shoes: { style: 'hightops', color: '#f2f2f2', accent: '#e86fa3' }, accessories: ['phone', 'earrings'],
  },
  photographer: {
    name: 'Photographer', body: 'male', build: 'skinny', skin: S.medium,
    hair: { style: 'spiky', color: H.darkBrown },
    top: { style: 'polo', color: '#3f7a5a' }, bottom: { style: 'pants', color: '#c7b28a' },
    shoes: { style: 'sneakers', color: '#3b3f4a' }, accessories: ['camera', 'backpack'],
  },
  summer: {
    name: 'Summer Day', body: 'female', skin: S.brown,
    hair: { style: 'afro', color: H.darkBrown },
    top: { style: 'dress', color: '#f2c94c', accent: '#e86f3a' }, bottom: { style: 'bare' },
    shoes: { style: 'simple', color: '#f2ece2' }, accessories: ['sunglasses', 'earrings', 'coffee'],
  },
  streetSkater: {
    name: 'Street Skater', body: 'female', skin: S.light,
    hair: { style: 'ponytail', color: H.platinum },
    top: { style: 'tshirt', color: '#2d2d33' }, bottom: { style: 'widePants', color: '#5b5b5b' },
    shoes: { style: 'hightops', color: '#d64545' }, accessories: [{ type: 'cap', color: '#d64545' }, { type: 'skateboard', color: '#3fae6c' }],
  },
  gamer: {
    name: 'Gamer', body: 'male', build: 'chubby', height: 'short', skin: S.fair,
    hair: { style: 'spiky', color: H.green },
    top: { style: 'tshirt', color: '#2d2d33' }, bottom: { style: 'joggers', color: '#3b4357' },
    shoes: { style: 'sneakers', color: '#3fae6c' }, accessories: ['headphones', 'glasses', 'phone'],
  },
  futurist: {
    name: 'Futurist', body: 'male', height: 'tall', skin: S.deep,
    hair: { style: 'mohawk', color: H.platinum }, facialHair: { style: 'goatee', color: H.platinum },
    top: { style: 'hoodie', color: '#e8ecf2', accent: '#37d6ff' }, bottom: { style: 'joggers', color: '#2d2d33', accent: '#37d6ff' },
    shoes: { style: 'hightops', color: '#e8ecf2', accent: '#37d6ff' }, accessories: ['sunglasses', { type: 'hoverboard', color: '#2d2d33' }],
  },
  teacher: {
    name: 'Teacher', body: 'female', build: 'chubby', skin: S.medium,
    hair: { style: 'bob', color: H.black },
    top: { style: 'sweater', color: '#3a6ea5', accent: '#f2ece2' }, bottom: { style: 'pants', color: '#5b5b5b' },
    shoes: { style: 'simple', color: '#2d2a2a' }, accessories: ['glasses', { type: 'book', side: 'R' }, 'coffee'],
  },
  traveler: {
    name: 'Traveler', body: 'male', skin: S.olive,
    hair: { style: 'short', color: H.brown }, facialHair: { style: 'stubble' },
    top: { style: 'polo', color: '#f2ece2', accent: '#2f8f8f' }, bottom: { style: 'shorts', color: '#2f8f8f' },
    shoes: { style: 'sneakers', color: '#f2ece2' }, accessories: [{ type: 'cap', color: '#f2ece2' }, 'sunglasses', 'backpack', 'camera'],
  },
};
