export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "running"
  | "paused"
  | "waiting_window"
  | "completed"
  | "cancelled";

export type VariationMode = "random" | "sequential";
export type WeekDay = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

export interface Campaign {
  id: string;
  orgId: string;
  name: string;
  status: CampaignStatus;
  scheduleDays: WeekDay[];
  scheduleStart: string;
  scheduleEnd: string;
  intervalMinSeconds: number;
  intervalMaxSeconds: number;
  variationMode: VariationMode;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  totalContacts: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
  /** Preenchido quando a migration `updated_at` em campaigns estiver aplicada */
  updatedAt?: string | null;
}

export interface MessageVariation {
  id: string;
  campaignId: string;
  body: string;
  imageUrl: string | null;
  sortOrder: number;
}

export interface CreateCampaignDto {
  name: string;
  scheduleDays?: WeekDay[];
  scheduleStart?: string;
  scheduleEnd?: string;
  intervalMinSeconds?: number;
  intervalMaxSeconds?: number;
  variationMode?: VariationMode;
  scheduledAt?: string;
}

export interface CampaignProgress {
  campaignId: string;
  status: CampaignStatus;
  totalContacts: number;
  sentCount: number;
  failedCount: number;
  pendingCount: number;
  lastDispatched?: {
    contactName: string;
    phone: string;
    status: "sent" | "failed";
    messageType: "rcs" | "sms";
    dispatchedAt: string;
  };
}
