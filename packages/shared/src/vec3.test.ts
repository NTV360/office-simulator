import { describe, expect, it } from 'vitest';
import { Vec3 } from './vec3';

describe('Vec3', () => {
  it('starts at the origin or at the given point', () => {
    expect(new Vec3()).toMatchObject({ x: 0, y: 0, z: 0 });
    expect(new Vec3(1, 2, 3)).toMatchObject({ x: 1, y: 2, z: 3 });
  });

  it('clone makes an independent copy', () => {
    const a = new Vec3(1, 2, 3);
    const b = a.clone();
    b.x = 99;
    expect(a.x).toBe(1);
    expect(b).toBeInstanceOf(Vec3);
    expect(b).toMatchObject({ x: 99, y: 2, z: 3 });
  });

  it('copy takes the coordinates of any point-like object and returns itself', () => {
    const a = new Vec3();
    expect(a.copy({ x: 4, y: 5, z: 6 })).toBe(a);
    expect(a).toMatchObject({ x: 4, y: 5, z: 6 });
    a.copy(new Vec3(7, 8, 9)); // another Vec3 works too
    expect(a).toMatchObject({ x: 7, y: 8, z: 9 });
  });

  it('measures distance in 3D, symmetric and zero to itself', () => {
    const a = new Vec3(0, 0, 0), b = new Vec3(3, 4, 12);
    expect(a.distanceTo(b)).toBe(13);
    expect(b.distanceTo(a)).toBe(13);
    expect(b.distanceTo(b)).toBe(0);
    expect(new Vec3(1, 0, 0).distanceTo({ x: 1, y: 0, z: 0 })).toBe(0); // accepts plain objects
  });
});
