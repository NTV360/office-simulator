/**
 * A point or direction in 3D, in metres. The simulation's replacement for THREE.Vector3, so shared code does
 * not depend on Three.js. It has only the methods the simulation actually uses, and plain public x, y, z
 * fields, so Three.js methods such as `position.copy(v)` and `position.set(v.x, v.y, v.z)` accept it directly.
 */
class Vec3 {
  x: number;
  y: number;
  z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  /** Copy another point's coordinates into this one. */
  copy(v: { x: number; y: number; z: number }): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  /** A new, independent point with the same coordinates. */
  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }

  /** Straight-line distance to another point. Same arithmetic as THREE.Vector3.distanceTo. */
  distanceTo(v: { x: number; y: number; z: number }): number {
    const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}

export { Vec3 };
