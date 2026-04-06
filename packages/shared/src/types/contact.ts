export type ContactStatus = 'pending' | 'sent' | 'failed' | 'skipped'

export interface Contact {
  id: string
  campaignId: string
  name: string | null
  phone: string
  extra: Record<string, string> | null
  status: ContactStatus
  sentAt: string | null
  errorMessage: string | null
}

export interface CreateContactDto {
  name?: string
  phone: string
  extra?: Record<string, string>
}
