// Chibi preset library — spread and override to make variations:
//   { ...CHIBI_PRESETS.barista, body: 'male', hair: 'quiff' }
import { DEFAULT_MALE, DEFAULT_FEMALE, SKIN_TONES as S, HAIR_COLORS as H, EYE_COLORS as E } from './chibi-character.js';

export const CHIBI_PRESETS = {
  defaultMale: DEFAULT_MALE,
  defaultFemale: DEFAULT_FEMALE,

  // inspired by the original pack
  santa: {
    name: 'Santa', body: 'male', build: 'chubby', height: 'short', skin: S.fair, cheeks: true,
    eyes: { style: 'dots' }, hair: { style: 'none' }, facialHair: { style: 'fullBeard', color: H.white },
    top: { style: 'jacket', color: '#8e1b2a', accent: '#f6f1ea' }, bottom: { style: 'pants', color: '#8e1b2a' },
    shoes: { style: 'boots', color: '#1d1a19' }, accessories: ['santaHat', 'belt', 'gloves'],
  },
  beardedGuy: {
    name: 'Bearded Guy', body: 'male', skin: S.peach, eyes: { style: 'closed' },
    hair: { style: 'short', color: H.black }, facialHair: { style: 'beard', color: H.black },
    top: { style: 'longsleeve', color: '#1f1f22' }, bottom: { style: 'jeans', color: '#252c3d' },
    shoes: { style: 'simple', color: '#1d1a19' }, accessories: [],
  },
  blondeKid: {
    name: 'Blonde Kid', body: 'male', build: 'skinny', height: 'short', skin: S.fair,
    eyes: { style: 'round', color: E.blue }, hair: { style: 'swept', color: H.blonde },
    top: { style: 'tshirt', color: '#c8262f' }, bottom: { style: 'shorts', color: '#2d5ca8' },
    shoes: { style: 'sneakers', color: '#1d1a19' }, accessories: [],
  },
  girlNextDoor: {
    name: 'Girl Next Door', body: 'female', build: 'skinny', height: 'short', skin: S.fair, cheeks: true,
    eyes: { style: 'big', color: E.brown }, hair: { style: 'long', color: H.darkBrown },
    top: { style: 'tanktop', color: '#b8479b' }, bottom: { style: 'shorts', color: '#2d5ca8' },
    shoes: { style: 'simple', color: '#f2c94c' }, accessories: [],
  },

  // variety
  barista: {
    name: 'Barista', body: 'female', skin: S.olive, cheeks: true, eyes: { style: 'round', color: E.hazel },
    hair: { style: 'bun', color: H.chestnut }, top: { style: 'polo', color: '#2f6b4f', accent: '#f6f1ea' },
    bottom: { style: 'pants', color: '#2a2a2e' }, shoes: { style: 'sneakers', color: '#f6f1ea' }, accessories: ['coffee'],
  },
  skater: {
    name: 'Skater', body: 'male', build: 'skinny', skin: S.tan, hair: { style: 'curly', color: H.black },
    top: { style: 'hoodie', color: '#2fb5a8' }, bottom: { style: 'shorts', color: '#c7b28a' },
    shoes: { style: 'sneakers', color: '#2a2a2e' }, accessories: [{ type: 'beanie', color: '#f2b43c' }, 'skateboard'],
  },
  hoverKid: {
    name: 'Hover Kid', body: 'female', height: 'short', skin: S.medium, cheeks: true, eyes: { style: 'big', color: E.green },
    hair: { style: 'pigtails', color: H.pink }, top: { style: 'jacket', color: '#2d2d33', accent: '#37d6ff' },
    bottom: { style: 'leggings', color: '#1f2230' }, shoes: { style: 'boots', color: '#e8ecf2' }, accessories: ['sunglasses', 'hoverboard'],
  },
  developer: {
    name: 'Developer', body: 'male', build: 'chubby', skin: S.brown, hair: { style: 'afro', color: H.black },
    facialHair: { style: 'stubble' }, top: { style: 'hoodie', color: '#3b3f4a' }, bottom: { style: 'joggers', color: '#2a2a2e' },
    shoes: { style: 'sneakers', color: '#e8e8ea', accent: '#2a2a2e' }, accessories: ['headphones', 'tablet'],
  },
  officeLady: {
    name: 'Office Lady', body: 'female', height: 'tall', skin: S.light, eyes: { style: 'round', color: E.grey },
    hair: { style: 'bob', color: H.black }, top: { style: 'jacket', color: '#2f3d6e' }, bottom: { style: 'skirt', color: '#2f3d6e' },
    shoes: { style: 'simple', color: '#1d1a19' }, accessories: ['earrings', 'phone', 'watch'],
  },
  businessman: {
    name: 'Businessman', body: 'male', height: 'tall', skin: S.porcelain, eyes: { style: 'round', color: E.blue },
    hair: { style: 'quiff', color: H.ginger }, facialHair: { style: 'beard', color: H.ginger },
    top: { style: 'jacket', color: '#8e1b2a' }, bottom: { style: 'pants', color: '#3b1714' },
    shoes: { style: 'sneakers', color: '#b32642' }, accessories: ['watch', 'briefcase'],
  },
  grandpa: {
    name: 'Grandpa', body: 'male', build: 'chubby', height: 'short', skin: S.light, eyes: { style: 'closed' },
    hair: { style: 'none' }, facialHair: { style: 'moustache', color: H.white },
    top: { style: 'sweater', color: '#7a5a3a', accent: '#c9a76a' }, bottom: { style: 'pants', color: '#5b5b5b' },
    shoes: { style: 'simple', color: '#3b2a20' }, accessories: [{ type: 'cap', color: '#5c6b4a' }, 'glasses', 'book'],
  },
  grandma: {
    name: 'Grandma', body: 'female', build: 'chubby', height: 'short', skin: S.fair, cheeks: true, eyes: { style: 'closed' },
    hair: { style: 'bun', color: H.grey }, top: { style: 'dress', color: '#8f63dd', accent: '#f2ece2' },
    bottom: { style: 'bare' }, shoes: { style: 'simple', color: '#5e3b24' }, accessories: ['glasses', 'coffee'],
  },
  musician: {
    name: 'Musician', body: 'male', height: 'tall', skin: S.olive, hair: { style: 'long', color: H.darkBrown },
    facialHair: { style: 'goatee' }, top: { style: 'jacket', color: '#1f1f22', accent: '#d64545' },
    bottom: { style: 'jeans', color: '#2f4e7a' }, shoes: { style: 'boots', color: '#3b2a20' }, accessories: ['headphones', 'sunglasses'],
  },
  student: {
    name: 'Student', body: 'female', build: 'skinny', skin: S.porcelain, cheeks: true, eyes: { style: 'big', color: E.green },
    hair: { style: 'ponytail', color: H.auburn }, top: { style: 'sweater', color: '#e8d6a8', accent: '#3a6ea5' },
    bottom: { style: 'skirt', color: '#3a3f5c' }, shoes: { style: 'simple', color: '#3b2a20' }, accessories: ['glasses', 'backpack', 'book'],
  },
  runner: {
    name: 'Runner', body: 'male', build: 'skinny', height: 'tall', skin: S.deep, hair: { style: 'buzz', color: H.black },
    top: { style: 'tanktop', color: '#e86f3a' }, bottom: { style: 'shorts', color: '#1f2230' },
    shoes: { style: 'sneakers', color: '#37d6ff', accent: '#ffffff' }, accessories: [{ type: 'headphones', color: '#f2f2f2', accent: '#37d6ff' }, 'watch'],
  },
  partyKid: {
    name: 'Party Kid', body: 'male', build: 'chubby', height: 'short', skin: S.peach, cheeks: true, eyes: { style: 'big', color: E.brown },
    hair: { style: 'spiky', color: H.chestnut }, top: { style: 'tshirt', color: '#f2b43c' }, bottom: { style: 'shorts', color: '#4f86d9' },
    shoes: { style: 'sneakers', color: '#d64545' }, accessories: ['bowtie', 'balloon'],
  },
  icecreamGirl: {
    name: 'Ice Cream Day', body: 'female', height: 'short', skin: S.brown, cheeks: true, eyes: { style: 'big', color: E.black },
    hair: { style: 'afro', color: H.black }, top: { style: 'dress', color: '#ee7fb0', accent: '#f6f1ea' },
    bottom: { style: 'bare' }, shoes: { style: 'sneakers', color: '#f6f1ea' }, accessories: [{ type: 'icecream', color: '#8fdcc0' }],
  },
  punk: {
    name: 'Punk', body: 'male', skin: S.fair, hair: { style: 'mohawk', color: H.teal }, facialHair: { style: 'stubble' },
    top: { style: 'tanktop', color: '#1f1f22' }, bottom: { style: 'jeans', color: '#2a2a2e' },
    shoes: { style: 'boots', color: '#1d1a19' }, accessories: ['sunglasses', 'belt', 'gloves'],
  },
  hiker: {
    name: 'Hiker', body: 'female', skin: S.tan, eyes: { style: 'round', color: E.brown }, hair: { style: 'ponytail', color: H.brown },
    top: { style: 'tshirt', color: '#d9653b' }, bottom: { style: 'shorts', color: '#5c6b4a' },
    shoes: { style: 'boots', color: '#6b4a2e' }, accessories: [{ type: 'cap', color: '#3f7a5a' }, 'backpack', 'watch'],
  },
  winterWalker: {
    name: 'Winter Walker', body: 'female', build: 'average', height: 'tall', skin: S.light, cheeks: true,
    hair: { style: 'long', color: H.platinum }, top: { style: 'sweater', color: '#3a6ea5', accent: '#f6f1ea' },
    bottom: { style: 'leggings', color: '#2a2a2e' }, shoes: { style: 'boots', color: '#7a4425' }, accessories: [{ type: 'beanie', color: '#c9473f' }, 'scarf'],
  },
  gamer: {
    name: 'Gamer', body: 'male', build: 'chubby', skin: S.fair, eyes: { style: 'round', color: E.green },
    hair: { style: 'curly', color: H.purple }, top: { style: 'tshirt', color: '#2d2d33' }, bottom: { style: 'joggers', color: '#3b4357' },
    shoes: { style: 'sneakers', color: '#3fae6c' }, accessories: ['headphones', 'glasses', 'phone'],
  },
  teacher: {
    name: 'Teacher', body: 'female', build: 'chubby', skin: S.medium, eyes: { style: 'round', color: E.brown },
    hair: { style: 'bob', color: H.chestnut }, top: { style: 'longsleeve', color: '#5b8f6a' }, bottom: { style: 'pants', color: '#5b5b5b' },
    shoes: { style: 'simple', color: '#2b2522' }, accessories: ['glasses', { type: 'book', side: 'R' }, 'coffee'],
  },
  gentleman: {
    name: 'Gentleman', body: 'male', height: 'tall', skin: S.dark, hair: { style: 'short', color: H.black },
    facialHair: { style: 'moustache', color: H.black }, top: { style: 'longsleeve', color: '#f2f2f2' },
    bottom: { style: 'pants', color: '#1f2230' }, shoes: { style: 'simple', color: '#1d1a19' }, accessories: ['tie', 'watch', 'briefcase'],
  },
};
