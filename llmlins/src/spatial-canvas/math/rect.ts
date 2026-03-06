import type { Rect, Vec2, CanvasShape } from '../types.js'
import { rotate } from './vec.js'

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

export function rectContainsPoint(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height
}

export function aabbFromPoints(points: Vec2[]): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function rotatedCorners(shape: CanvasShape): Vec2[] {
  const cx = shape.x + shape.width / 2
  const cy = shape.y + shape.height / 2
  const hw = shape.width / 2
  const hh = shape.height / 2
  const corners: Vec2[] = [
    { x: -hw, y: -hh },
    { x:  hw, y: -hh },
    { x:  hw, y:  hh },
    { x: -hw, y:  hh },
  ]
  return corners.map(c => {
    const r = rotate(c, shape.rotation)
    return { x: r.x + cx, y: r.y + cy }
  })
}

export function shapeBounds(shape: CanvasShape): Rect {
  if (!shape.rotation) {
    return { x: shape.x, y: shape.y, width: shape.width, height: shape.height }
  }
  return aabbFromPoints(rotatedCorners(shape))
}

/** Point-in-shape test using inverse rotation into the shape's local frame. */
export function pointInShape(shape: CanvasShape, x: number, y: number): boolean {
  if (!shape.rotation) {
    return (
      x >= shape.x && x <= shape.x + shape.width &&
      y >= shape.y && y <= shape.y + shape.height
    )
  }
  const cx = shape.x + shape.width / 2
  const cy = shape.y + shape.height / 2
  const local = rotate({ x: x - cx, y: y - cy }, -shape.rotation)
  return (
    local.x >= -shape.width / 2 && local.x <= shape.width / 2 &&
    local.y >= -shape.height / 2 && local.y <= shape.height / 2
  )
}
