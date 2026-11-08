import { test } from 'node:test'
import assert from 'node:assert/strict'
import { laneShiftPath, mergeParentPath } from '../src/client/scm/graph-path.ts'

test('lane shift uses VS Code rounded swimlane arcs when moving left', () => {
  assert.equal(
    laneShiftPath(2, 1),
    'M 27.5 0 V 9 A 5 5 0 0 1 22.5 14 H 21.5 A 5 5 0 0 0 16.5 19 V 28',
  )
})

test('lane shift mirrors its arcs when moving right', () => {
  assert.equal(
    laneShiftPath(0, 1),
    'M 5.5 0 V 9 A 5 5 0 0 0 10.5 14 H 11.5 A 5 5 0 0 1 16.5 19 V 28',
  )
})

test('same-lane continuation is a straight vertical path', () => {
  assert.equal(laneShiftPath(1, 1), 'M 16.5 0 V 28')
})

test('merge parent connector follows VS Code arc plus node join', () => {
  assert.equal(
    mergeParentPath(1, 0),
    'M 11 14 A 11 11 0 0 1 22 28 M 11 14 H 5.5',
  )
})
