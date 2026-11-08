/**
 * Geometry tests for the commit-graph SVG paths.
 *
 * Every expected string is computed from VS Code's `renderSCMHistoryItemGraph`
 * constants (lane width 11, curve radius 5) stretched to a 28px row, so a
 * changed number here means the drawing no longer matches VS Code.
 * @module dsh-solution-explorer/test/graph-path
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  laneCenter,
  laneClosePath,
  laneCountWidth,
  laneEdge,
  laneShiftPath,
  mergeParentPath,
  SWIMLANE_HEIGHT,
  SWIMLANE_MID,
  SWIMLANE_WIDTH,
  verticalPath,
} from '../src/client/scm/graph-path.ts'

test('lanes are centered at 11 * (index + 1), like VS Code', () => {
  assert.equal(SWIMLANE_WIDTH, 11)
  assert.equal(SWIMLANE_HEIGHT, 28)
  assert.equal(SWIMLANE_MID, 14)
  assert.equal(laneCenter(0), 11)
  assert.equal(laneCenter(1), 22)
  assert.equal(laneCenter(4), 55)
  assert.equal(laneEdge(0), 0)
  assert.equal(laneEdge(2), 22)
})

test('the column is wide enough for every lane plus one, like VS Code', () => {
  assert.equal(laneCountWidth(0), 22, 'an empty row still holds one lane')
  assert.equal(laneCountWidth(1), 22)
  assert.equal(laneCountWidth(2), 33)
  assert.equal(laneCountWidth(9), 110)
})

test('a lane that keeps its column is a full-height vertical line', () => {
  assert.equal(verticalPath(0), 'M 11 0 V 28')
  assert.equal(verticalPath(2), 'M 33 0 V 28')
  assert.equal(verticalPath(1, 0, SWIMLANE_MID), 'M 22 0 V 14')
  assert.equal(verticalPath(1, SWIMLANE_MID, SWIMLANE_HEIGHT), 'M 22 14 V 28')
})

test('lane shift uses VS Code rounded swimlane arcs when moving left', () => {
  assert.equal(
    laneShiftPath(2, 1),
    'M 33 0 V 9 A 5 5 0 0 1 28 14 H 27 A 5 5 0 0 0 22 19 V 28',
  )
})

test('lane shift mirrors its arcs when moving right', () => {
  assert.equal(
    laneShiftPath(0, 1),
    'M 11 0 V 9 A 5 5 0 0 0 16 14 H 17 A 5 5 0 0 1 22 19 V 28',
  )
})

test('a lane shift over three columns stays inside the lanes it crosses', () => {
  const d = laneShiftPath(0, 3)
  assert.equal(d, 'M 11 0 V 9 A 5 5 0 0 0 16 14 H 39 A 5 5 0 0 1 44 19 V 28')
  assert.ok(d.includes('H 39'), 'the horizontal run stops one curve radius short')
})

test('same-lane continuation is a straight vertical path', () => {
  assert.equal(laneShiftPath(1, 1), 'M 22 0 V 28')
})

test('merge parent connector follows VS Code arc plus node join', () => {
  // Parent lane 1, merge node in lane 0: no horizontal run, just the elbow.
  assert.equal(
    mergeParentPath(1, 0),
    'M 11 14 A 11 14 0 0 1 22 28 M 11 14 H 11',
  )
  // Parent lane 0, merge node in lane 2: the join runs back across the lanes.
  assert.equal(
    mergeParentPath(0, 2),
    'M 0 14 A 11 14 0 0 1 11 28 M 0 14 H 33',
  )
})

test('a folded lane is closed into the node instead of ending in mid-air', () => {
  // VS Code's "base commit" connector: row top -> arc -> node center.
  assert.equal(laneClosePath(1, 0), 'M 22 0 A 11 14 0 0 1 11 14 H 11')
  assert.equal(laneClosePath(2, 0), 'M 33 0 A 11 14 0 0 1 22 14 H 11')
  assert.equal(laneClosePath(0, 1), 'M 11 0 A 11 14 0 0 0 22 14 H 22')
})
