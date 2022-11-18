/* globals
canvas,
PIXI,
foundry
*/
"use strict";

// Represent a Wall in as a set of 4 3d points.

import { PlanePoints3d } from "./PlanePoints3d.js";
import { Point3d } from "./Point3d.js";
import { ClipperPaths } from "./ClipperPaths.js";

export class WallPoints3d extends PlanePoints3d {
  constructor(object) {
    const { A, B, topZ, bottomZ } = object;
    const maxR = canvas.dimensions.maxR;

    const top = isFinite(topZ) ? topZ : maxR;
    const bottom = isFinite(bottomZ) ? bottomZ : -maxR;

    const points = new Array(4);
    points[0] = new Point3d(A.x, A.y, top);
    points[1] = new Point3d(B.x, B.y, top);
    points[2] = new Point3d(B.x, B.y, bottom);
    points[3] = new Point3d(A.x, A.y, bottom);

    super(object, points);
  }

  /**
   * Given an array of terrain walls, trim the polygons by combining.
   * Viewer and target locations used to sort the walls by distance.
   * @param {WallPoints3d[]} walls      Set, Array, or Map of terrain walls
   * @param {Point3d} viewerLoc         Location of the viewer
   * @returns {ClipperPaths}
   */
  static combineTerrainWalls(walls, viewerLoc) {
    // TODO: Handle walls that are actually lines?

    walls = [...walls];

    const combined = new ClipperPaths();

    // Examine each pair of walls once
    const nWalls = walls.length;
    const iLn = nWalls - 1;
    for ( let i = 0; i < iLn; i += 1 ) {
      // Consider wall I  the AB segment
      const wi = walls[i];
      const { A, B } = wi.object;

      const ccwABV = ccw(A, B, viewerLoc);
      if ( !ccwABV ) continue; // Wall and viewer are collinear

      for ( let j = i + 1; j < nWalls; j += 1 ) {
        // Consider wall J the CD segment
        const wj = walls[j];
        const { A: C, B: D } = wj.object;

        const ccwCDV = ccw(C, D, viewerLoc);
        if ( !ccwCDV ) continue; // Wall and viewer are collinear

        const ccwABC = ccw(A, B, C);
        const ccwABD = ccw(A, B, D);

        if ( !(ccwABC || ccwABD) ) continue; // Walls are collinear

        const ccwCDA = ccw(C, D, A);
        const ccwCDB = ccw(C, D, B);

        // One wall may be entirely on one side of the other wall
        // Forms something like a T or V or / \
        let wFront;
        let wBack;

        if ( ccwABC === ccwABD || !ccwABD || !ccwABC ) {
          // CD is entirely on one side of AB
          const endpointCCW = ccwABC === 0 ? ccwABD : ccwABC;
          if ( endpointCCW === ccwABV ) {
            // Viewer is on the T side
            wFront = wj;
            wBack = wi;
          } else {
            wFront = wi;
            wBack = wj;
          }
        } else if ( ccwCDA === ccwCDB || !ccwCDA || !ccwCDB ) {
          // AB is entirely on one side of CD
          const endpointCCW = ccwCDA === 0 ? ccwCDB : ccwCDA;
          if ( endpointCCW === ccwCDV ) {
            wFront = wi;
            wBack = wj;
          } else {
            wFront = wj;
            wBack = wi;
          }
        }

        if ( wFront ) {
          const cpFront = ClipperPaths.fromPolygons([new PIXI.Polygon(wFront.perspectiveTransform())]);
          const cpBack = ClipperPaths.fromPolygons([new PIXI.Polygon(wBack.perspectiveTransform())]);
          const cpIntersect = cpFront.intersectPaths(cpBack);
          if ( cpIntersect.paths.length ) combined.add(cpIntersect);
          continue;
        }

        // Walls otherwise strictly cross, forming an X.
        const res = handleTerrainWallsCross(wi, wj, ccwABV, ccwCDV);
        if ( !res ) continue;
        if ( res.wiPath.paths.length ) combined.add(res.wiPath);
        if ( res.wjPath.paths.length ) combined.add(res.wjPath);
      }
    }

    if ( !combined.paths.length ) return null;
    const finalPath = combined.combine();
    finalPath.clean();
    return finalPath;
  }
}

/**
 * Determine whether C is clockwise or counter-clockwise or collinear to AB.
 * @param {PIXI.Point} a
 * @param {PIXI.Point} b
 * @param {PIXI.Point} c
 * @returns {-1|0|1}
 */
function ccw(a, b, c) {
  return Math.sign(foundry.utils.orient2dFast(a, b, c));
}

/**
 * Terrain walls wi and wj assumed to cross. Cut them at the intersection point and
 * return the intersect for the portions of each set.
 * @param {WallPoints3d} wi
 * @param {WallPoints3d} wj
 * @param {-1|1} ccwABV
 * @param {-1|1} ccwCDV
 * @returns {null|object{wiPath: ClipperPaths, wjPath: ClipperPaths}}
 */
function handleTerrainWallsCross(wi, wj, ccwABV, ccwCDV) {
  const { A, B } = wi.object;
  const { A: C, B: D } = wj.object;

  const ix = foundry.utils.lineLineIntersection(A, B, C, D);
  if ( !ix ) {
    console.warn("combineTerrainWalls: walls cross but intersection not found.");
    return undefined;
  }

  // Create 4 subset walls: A|ix, B|ix, C|ix, D|ix
  const wiA = new WallPoints3d(wi.object);
  const wiB = new WallPoints3d(wi.object);
  const wjC = new WallPoints3d(wj.object);
  const wjD = new WallPoints3d(wj.object);

  wiA.points[1].x = ix.x;
  wiA.points[1].y = ix.y;
  wiA.points[2].x = ix.x;
  wiA.points[2].y = ix.y;

  wiB.points[0].x = ix.x;
  wiB.points[0].y = ix.y;
  wiB.points[3].x = ix.x;
  wiB.points[3].y = ix.y;

  wjC.points[1].x = ix.x;
  wjC.points[1].y = ix.y;
  wjC.points[2].x = ix.x;
  wjC.points[2].y = ix.y;

  wjD.points[0].x = ix.x;
  wjD.points[0].y = ix.y;
  wjD.points[3].x = ix.x;
  wjD.points[3].y = ix.y;

  let wiFront;
  let wiBack;
  let wjFront;
  let wjBack;

  // Determine which endpoint is behind the other
  // Split the walls at the ix and intersect the relevant pieces
  if ( ccwABV === -1 ) {
    // A --> B --> V is clockwise
    wjFront = wjD;
    wjBack = wjC;

    if ( ccwCDV === -1 ) {
      // C --> D --> V is clockwise
      // Viewer is closest to A and D looking toward the ix
      // ix --> B is behind ix --> D
      // ix --> C is behind ix --> A
      wiFront = wiA;
      wiBack = wiB;

    } else {
      // C --> D --> V is CCW
      // Viewer is closest to B and D
      // ix --> C is behind ix --> B
      // ix --> A is behind ix --> D
      wiFront = wiB;
      wiBack = wiA;
    }

  } else {
    // A --> B --> V is CCW
    wjFront = wjC;
    wjBack = wjD;
    if ( ccwCDV === -1 ) {
      // C --> D --> V is clockwise
      // Viewer is closest to A and C
      // ix --> D is behind ix --> A
      // ix --> B is behind ix --> C
      wiFront = wiA;
      wiBack = wiB;

    } else {
      // C --> D --> V is CCW
      // Viewer is closest to B and C
      // ix --> D is behind ix --> B
      // ix --> A is behind ix --> C
      wiFront = wiB;
      wiBack = wiA;

    }
  }
  wiFront.setViewMatrix(wi.M);
  wiBack.setViewMatrix(wi.M);
  wjFront.setViewMatrix(wj.M);
  wjBack.setViewMatrix(wj.M);

  const cpWiFront = ClipperPaths.fromPolygons([new PIXI.Polygon(wiFront.perspectiveTransform())]);
  const cpWiBack = ClipperPaths.fromPolygons([new PIXI.Polygon(wiBack.perspectiveTransform())]);
  const cpWjFront = ClipperPaths.fromPolygons([new PIXI.Polygon(wjFront.perspectiveTransform())]);
  const cpWjBack = ClipperPaths.fromPolygons([new PIXI.Polygon(wjBack.perspectiveTransform())]);

  const cpWiIntersect = cpWjFront.intersectPaths(cpWiBack);
  const cpWjIntersect = cpWiFront.intersectPaths(cpWjBack);

  return { wiPath: cpWiIntersect, wjPath: cpWjIntersect };
}