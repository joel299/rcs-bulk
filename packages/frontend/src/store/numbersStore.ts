import { create } from 'zustand'
import type { RcsNumber } from '@rcs/shared'

interface NumbersState {
  numbers: RcsNumber[]
  loading: boolean
  setNumbers: (numbers: RcsNumber[]) => void
  addNumber: (n: RcsNumber) => void
  updateNumber: (id: string, updates: Partial<RcsNumber>) => void
  deleteNumber: (id: string) => void
  setLoading: (v: boolean) => void
}

export const useNumbers = create<NumbersState>((set) => ({
  numbers: [],
  loading: false,
  setNumbers: (numbers) => set({ numbers }),
  addNumber: (n) => set((s) => ({ numbers: [...s.numbers, n] })),
  updateNumber: (id, updates) =>
    set((s) => ({
      numbers: s.numbers.map((n) => (n.id === id ? { ...n, ...updates } : n)),
    })),
  deleteNumber: (id) =>
    set((s) => ({ numbers: s.numbers.filter((n) => n.id !== id) })),
  setLoading: (loading) => set({ loading }),
}))
