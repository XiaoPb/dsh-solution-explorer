/**
 * Shared commit-row fixtures for the graph tests. The `avd` history mirrors the
 * repository built by `.scratch/avd-merges.sh` on the emulator: four linear
 * base commits plus two `--no-ff` merges whose branches fork from the same
 * base commit, which is the case that used to break the merge-back lines.
 * @module dsh-solution-explorer/test/graph-fixture
 */
import type { CommitRow } from '../src/client/state/store.ts'

/** Builds a commit row; parents default to none so roots are easy to write. */
export function row(hash: string, parents: string[] = [], extra: Partial<CommitRow> = {}): CommitRow {
  return { hash, shortHash: hash.slice(0, 7), message: `subject ${hash}`, timestamp: 0, parents, ...extra }
}

/** C -> B -> A -> root */
export const linear = [
  row('C', ['B']),
  row('B', ['A']),
  row('A'),
]

/** M merges A and B, both of which fork from R. */
export const diamond = [
  row('M', ['A', 'B']),
  row('A', ['R']),
  row('B', ['R']),
  row('R'),
]

/** The emulator history: two merged feature branches over one shared base. */
export const avd = [
  row('merge-b', ['merge-a', 'feat-b2']),
  row('feat-b2', ['feat-b1']),
  row('feat-b1', ['feat-b0']),
  row('feat-b0', ['base-4']),
  row('merge-a', ['base-4', 'feat-a2']),
  row('feat-a2', ['feat-a1']),
  row('feat-a1', ['base-4']),
  row('base-4', ['base-3']),
  row('base-3', ['base-2']),
  row('base-2', ['base-1']),
  row('base-1'),
]

/**
 * The emulator history after `.scratch/avd-multilevel-merges.sh` and
 * `.scratch/avd-concurrent-merges.sh`: the same repo plus
 *
 * - `mz`/`my`/`mx`: three branches forked from one ancient commit and merged
 *   into master one after another, so several lanes wait for `notes` at once,
 * - `octo`: an octopus merge with three parents,
 * - `dmerge`/`dmidmerge`/`ddeepmerge`: merges nested three levels deep,
 * - `cmerge`/`csmerge`: a branch that merges its own sub-branch,
 * - `lmerge`: a branch forked far down the list and merged at the tip.
 *
 * This is the shape that used to break the merge-back connectors.
 */
export const multilevel = [
  row('mz', ['my', 'z2']),
  row('z2', ['z1']),
  row('z1', ['notes']),
  row('my', ['mx', 'y2']),
  row('y2', ['y1']),
  row('y1', ['notes']),
  row('mx', ['lmerge', 'x2']),
  row('x2', ['x1']),
  row('x1', ['notes']),
  row('lmerge', ['octo', 'l2']),
  row('l2', ['l1']),
  row('l1', ['d1']),
  row('octo', ['dmerge', 'e1', 'f1']),
  row('f1', ['dmerge']),
  row('e1', ['dmerge']),
  row('dmerge', ['cmerge', 'd2']),
  row('d2', ['dmidmerge']),
  row('dmidmerge', ['d1', 'dm2']),
  row('dm2', ['ddeepmerge']),
  row('ddeepmerge', ['dm1', 'dp2']),
  row('dp2', ['dp1']),
  row('dp1', ['dm1']),
  row('dm1', ['d1']),
  row('d1', ['cmerge']),
  row('cmerge', ['bmerge', 'c2']),
  row('c2', ['csmerge']),
  row('csmerge', ['c1', 'cs2']),
  row('cs2', ['cs1']),
  row('cs1', ['c1']),
  row('c1', ['bmerge']),
  row('bmerge', ['amerge', 'b2']),
  row('b2', ['b1']),
  row('b1', ['amerge']),
  row('amerge', ['deck', 'a3']),
  row('a3', ['a2']),
  row('a2', ['a1']),
  row('a1', ['deck']),
  row('deck', ['pdf']),
  row('pdf', ['notes']),
  row('notes', ['sample']),
  row('sample'),
]
