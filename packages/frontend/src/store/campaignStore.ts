import { create } from 'zustand'
import type { Campaign, MessageVariation } from '@rcs/shared'

interface CampaignState {
  campaigns: Campaign[]
  activeCampaign: Campaign | null
  variations: MessageVariation[]
  contacts: any[]
  setCampaigns: (campaigns: Campaign[]) => void
  addCampaign: (c: Campaign) => void
  setActiveCampaign: (c: Campaign | null) => void
  updateCampaign: (id: string, updates: Partial<Campaign>) => void
  setVariations: (v: MessageVariation[]) => void
  setContacts: (c: any[]) => void
}

export const useCampaignStore = create<CampaignState>((set) => ({
  campaigns: [],
  activeCampaign: null,
  variations: [],
  contacts: [],
  setCampaigns: (campaigns) => set({ campaigns }),
  addCampaign: (c) => set((s) => ({ campaigns: [c, ...s.campaigns] })),
  setActiveCampaign: (activeCampaign) => set({ activeCampaign, variations: [], contacts: [] }),
  updateCampaign: (id, updates) =>
    set((s) => ({
      campaigns: s.campaigns.map((c) => (c.id === id ? { ...c, ...updates } : c)),
      activeCampaign:
        s.activeCampaign?.id === id
          ? { ...s.activeCampaign, ...updates }
          : s.activeCampaign,
    })),
  setVariations: (variations) => set({ variations }),
  setContacts: (contacts) => set({ contacts }),
}))
