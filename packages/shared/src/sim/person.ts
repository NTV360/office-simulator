/**
 * Who drives a person. 'ai' people are staff: the simulation decides what they do. 'account' people are driven by a
 * human; the simulation never steps them, picks them for meetings, or counts them as staff.
 */
export type Controller = 'ai' | 'account';

export const isStaff = (p: { controller: Controller }): boolean => p.controller === 'ai';
export const isControlled = (p: { controller: Controller }): boolean => p.controller === 'account';
