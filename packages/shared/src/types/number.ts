export type NumberStatus = 'pending_auth' | 'authenticated' | 'disconnected' | 'paused'
export type RotationStrategy = 'round-robin' | 'least-used' | 'sequential'

export interface RcsNumber {
  id: string
  orgId: string
  name: string
  phoneLabel: string
  status: NumberStatus
  sessionPath: string | null
  messagesSentToday: number
  maxMessagesPerHour: number
  rotationStrategy: RotationStrategy
  createdAt: string
  updatedAt: string
}

export interface CreateNumberDto {
  name: string
  phoneLabel: string
  maxMessagesPerHour?: number
  rotationStrategy?: RotationStrategy
}
