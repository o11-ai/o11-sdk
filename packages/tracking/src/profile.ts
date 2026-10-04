export type ContactChannel = 'email' | 'imessage' | 'whatsapp';
export type TrackingProfile = {
  operationId: string; customerId: string; updatedAt: string; deleted?: boolean; name?: string;
  timezone?: string; preferredChannel?: ContactChannel;
  contacts?: { channel: ContactChannel; address: string; primary?: boolean; verifiedAt?: string; verification?: string }[];
  permissions?: { channel: ContactChannel | 'all'; purpose: 'retention' | 'support' | 'all'; status: 'allowed' | 'blocked'; changedAt: string; evidence: string }[];
};
export type TrackingCoverage = { operationId: string; startedAt: string; through: string };
