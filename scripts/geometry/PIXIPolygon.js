/* globals
PIXI,
ClipperLib,
foundry
*/
"use strict";

import { lineSegmentCrosses, elementsByIndex } from "../util.js";


/**
 * Returns the points of the polygon that make up the viewable perimeter
 * as seen from an origin.
 * @param {Point} origin                  Location of the viewer, in 2d.
 * @param {object} [options]
 * @param {boolean} [options.returnKeys]      Return index of viewable points instead of points
 * @param {boolean} [options.outermostOnly]   Return only the outermost two points
 * @returns {Point[]|number[]}
 */
function viewablePoints(origin, { returnKeys = false, outermostOnly = false } = {}) {
  // Key point is a line from origin to the point that does not intersect the polygon
  // the outermost key points are the most ccw and cw of the key points.

  // Possible paths:
  // 1. n   n   n   key key key
  // 2. key key key n   n   n
  // 3. key key n   n   key  <-- last key(s) should be shifted to beginning of array
  // 4. n   n   key key key n

  const pts = [...this.iteratePoints({ close: false })];
  const nPts = pts.length;
  const startKeys = [];
  const endKeys = [];

  let foundNonKeyFirst = false;
  let foundNonKeyAfter = false;
  let foundKey = false;
  for ( let i = 0; i < nPts; i += 1 ) {
    let isKey = true;
    const pt = pts[i];

    for ( const edge of this.iterateEdges() ) {
      if ( (edge.A.x === pt.x && edge.A.y === pt.y)
        || (edge.B.x === pt.x && edge.B.y === pt.y) ) continue;

      if ( foundry.utils.lineSegmentIntersects(origin, pt, edge.A, edge.B) ) {
        isKey = false;
        break;
      }
    }

    if ( isKey ) {
      foundKey = true;
      !foundNonKeyAfter && startKeys.push(i); // eslint-disable-line no-unused-expressions
      foundNonKeyAfter && endKeys.push(i); // eslint-disable-line no-unused-expressions
    } else { // !isKey
      foundNonKeyFirst ||= !foundKey;
      foundNonKeyAfter ||= foundKey;
      if ( foundNonKeyFirst && foundKey ) break; // Finished the key sequence
    }
  }

  // Keep the keys CW, same order as pts
  let keys = [...endKeys, ...startKeys];
  if ( outermostOnly ) keys = [keys[0], keys[keys.length - 1]];
  return returnKeys ? keys : elementsByIndex(pts, keys);
}

/**
 * Iterate over the polygon's {x, y} points in order.
 * If the polygon is closed and close is false,
 * the last two points (which should equal the first two points) will be dropped.
 * Otherwise, all points will be returned regardless of the close value.
 * @returns {x, y} PIXI.Point
 */
function* iteratePoints({close = true} = {}) {
  const dropped = (!this.isClosed || close) ? 0 : 2;
  const ln = this.points.length - dropped;
  for (let i = 0; i < ln; i += 2) {
    yield new PIXI.Point(this.points[i], this.points[i + 1]);
  }
}

/**
 * Iterate over the polygon's edges in order.
 * If the polygon is closed, the last two points will be ignored.
 * (Use close = true to return the last --> first edge.)
 * @param {object} [options]
 * @param {boolean} [close]   If true, return last point --> first point as edge.
 * @returns Return an object { A: {x, y}, B: {x, y}} for each edge
 * Edges link, such that edge0.B === edge.1.A.
 */
function* iterateEdges({close = true} = {}) {
  const dropped = this.isClosed ? 2 : 0;
  const ln = this.points.length;
  const iter = ln - dropped;
  if ( ln < 4 ) return;

  const firstA = new PIXI.Point(this.points[0], this.points[1]);
  let A = firstA;
  for (let i = 2; i < ln; i += 2) {
    const B = new PIXI.Point(this.points[i], this.points[i + 1]);
    yield { A, B };
    A = B;
  }

  if ( close ) {
    const B = firstA;
    yield { A, B };
  }
}

/**
 * Area of polygon
 * @returns {number}
 */
function area() {
  const path = this.toClipperPoints();
  return Math.abs(ClipperLib.Clipper.Area(path));
}

/**
 * Test if a line or lines crosses a polygon edge
 * @param {object[]} lines    Array of lines, with A and B PIXI.Points.
 * @returns {boolean}
 */
function linesCross(lines) {
  const fu = foundry.utils;

  for ( const edge of this.iterateEdges() ) {
    for ( const line of lines ) {
      if ( lineSegmentCrosses(edge.A, edge.B, line.A, line.B) ) return true;
    }
  }

  return false;
}

/**
 * Test whether the polygon is oriented clockwise.
 * @returns {boolean}
 */
function isClockwise() {
  if ( typeof this._isClockwise === "undefined") {
    const path = this.toClipperPoints();
    this._isClockwise = ClipperLib.Clipper.Orientation(path);
  }
  return this._isClockwise;
}

function reverseOrientation() {
  const reversed_pts = [];
  const pts = this.points;
  const ln = pts.length - 2;
  for (let i = ln; i >= 0; i -= 2) {
    reversed_pts.push(pts[i], pts[i + 1]);
  }
  this.points = reversed_pts;
  if ( typeof this._isClockwise !== "undefined" ) this._isClockwise = !this._isClockwise;
  return this;
}

/**
 * Use Clipper to pad (offset) polygon by delta.
 * @returns {PIXI.Polygon}
 */
function pad(delta, { miterLimit = 2, scalingFactor = 1 } = {}) {
  if ( miterLimit < 2) {
    console.warn("miterLimit for PIXI.Polygon.prototype.offset must be ≥ 2.");
    miterLimit = 2;
  }

  const solution = new ClipperLib.Paths();
  const c = new ClipperLib.ClipperOffset(miterLimit);
  c.AddPath(this.toClipperPoints({scalingFactor}), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  c.Execute(solution, delta);
  return PIXI.Polygon.fromClipperPoints(solution.length ? solution[0] : [], {scalingFactor});
}

/**
 * Convex hull algorithm.
 * Returns a polygon representing the convex hull of the given points.
 * Excludes collinear points.
 * Runs in O(n log n) time
 * @param {PIXI.Point[]} points
 * @returns {PIXI.Polygon}
 */
function convexhull(points) {
  const ln = points.length;
  if ( ln <= 1 ) return points;

  const newPoints = [...points];
  newPoints.sort(convexHullCmpFn);

  // Andrew's monotone chain algorithm.
  const upperHull = [];
  for ( let i = 0; i < ln; i += 1 ) {
    testHullPoint(upperHull, newPoints[i]);
  }
  upperHull.pop();

  const lowerHull = [];
  for ( let i = ln - 1; i >= 0; i -= 1 ) {
    testHullPoint(lowerHull, newPoints[i]);
  }
  lowerHull.pop();

  if ( upperHull.length === 1
    && lowerHull.length === 1
    && upperHull[0].x === lowerHull[0].x
    && upperHull[0].y === lowerHull[0].y ) return new PIXI.Polygon(upperHull);

  return new PIXI.Polygon(upperHull.concat(lowerHull));
}

function convexHullCmpFn(a, b) {
  const dx = a.x - b.x;
  return dx ? dx : a.y - b.y;
}

/**
 * Test the point against existing hull points.
 * @parma {PIXI.Point[]} hull
 * @param {PIXI.Point} point
*/
function testHullPoint(hull, p) {
  while ( hull.length >= 2 ) {
    const q = hull[hull.length - 1];
    const r = hull[hull.length - 2];
    // TO-DO: Isn't this a version of orient2d? Replace?
    if ( (q.x - r.x) * (p.y - r.y) >= (q.y - r.y) * (p.x - r.x) ) hull.pop();
    else break;
  }
  hull.push(p);
}

/**
 * Translate, shifting this polygon in the x and y direction. Return new polygon.
 * @param {Number} dx  Movement in the x direction.
 * @param {Number} dy  Movement in the y direction.
 * @return {PIXI.Polygon}
 */
function translate(dx, dy) {
  const pts = [];
  const ln = this.points.length;
  for (let i = 0; i < ln; i += 2) {
    pts.push(this.points[i] + dx, this.points[i + 1] + dy);
  }
  const out = new this.constructor(pts);
  out._isClockwise = this._isClockwise;
  if ( this.bounds ) out.bounds = out.getBounds(); // Bounds will have changed due to translate

  return out;
}


// ----------------  ADD METHODS TO THE PIXI.POLYGON PROTOTYPE --------------------------
export function registerPIXIPolygonMethods() {

  /**
   * Determine if a polygon is oriented clockwise, meaning tracing the polygon
   * moves in a clockwise direction.
   * This getter relies on a cached property, _isClockwise.
   * If you know the polygon orientation in advance, you should set this._isClockwise to avoid
   * this calculation.
   * This will close the polygon.
   * @type {boolean}
   */
  if ( !Object.hasOwn(PIXI.Polygon.prototype, "isClockwise") ) {

    Object.defineProperty(PIXI.Polygon.prototype, "isClockwise", {
      get: isClockwise,
      enumerable: false
    });

  }

  /**
   * Reverse the order of the polygon points.
   * @returns {PIXI.Polygon}
   */
  Object.defineProperty(PIXI.Polygon.prototype, "reverseOrientation", {
    value: reverseOrientation,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "iteratePoints", {
    value: iteratePoints,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "iterateEdges", {
    value: iterateEdges,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "area", {
    value: area,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "linesCross", {
    value: linesCross,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "pad", {
    value: pad,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon, "convexhull", {
    value: convexhull,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "translate", {
    value: translate,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "viewablePoints", {
    value: viewablePoints,
    writable: true,
    configurable: true
  });
}

