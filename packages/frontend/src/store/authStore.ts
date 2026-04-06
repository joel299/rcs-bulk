import { create } from 'zustand'
import type { User } from '@rcs/shared'

interface AuthState {
  user: User | null
  setUser: (u: User | null) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
}))
