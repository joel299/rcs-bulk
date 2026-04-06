export type MessageType = 'rcs' | 'sms'

export interface DispatchLog {
  id: string
  campaignId: string
  contactId: string
  numberId: string
  variationId: string
  status: 'sent' | 'failed'
  messageType: MessageType
  error: string | null
  dispatchedAt: string
}

export interface DispatchJobData {
  campaignId: string
  contactId: string
  orgId: string
  phone: string
  contactName: string | null
  message: string
  imageUrl: string | null
  variationId: string
  numberId: string
}
