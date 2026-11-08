/**
 * Controlled-input draft for components bound to the panel's mutable store.
 *
 * The panel store is a plain mutable object; changing it does not re-render
 * React. A controlled `<input value={store.value} onChange={...store...}>`
 * therefore gets its DOM value restored to the last rendered value after every
 * keystroke (the field looks read-only). Keeping a local React draft and
 * mirroring external writes (AI fill, clear after commit, repo switch) through
 * an effect gives normal typing without a full panel re-render per key.
 * @module dsh-solution-explorer/client/shared/draft
 */
import { useEffect, useState } from 'react'

/**
 * @param value - the external/store value to mirror.
 * @param onChange - called with every user edit (writes the store).
 * @returns the local draft value and its setter.
 */
export function useDraft(
  value: string,
  onChange: (value: string) => void,
): readonly [string, (value: string) => void] {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  const update = (next: string): void => {
    setDraft(next)
    onChange(next)
  }
  return [draft, update] as const
}
