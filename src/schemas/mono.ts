import { z } from "zod";

export const IncidentSchema = z.object({
  title: z.string(),
  description: z.string(),
  link: z.url(),
  guid: z.string(),
  published_at: z.iso.datetime(),
  timestamp: z.number(),
  is_ongoing: z.boolean(),
  status: z.string().nullable(),
  products: z.array(z.string()),
  affected_services: z.array(z.string()),
  outage_type: z.string(),
  provider: z.string().nullable(),
  severity: z.enum(["critical", "major", "minor", "none"]),
});

export const StatusResponseSchema = z.object({
  status: z.enum(["DOWNTIME_DETECTED", "OPERATIONAL"]),
  has_active_downtime: z.boolean(),
  active_incidents_count: z.number().int(),
  last_checked: z.iso.datetime(),
  active_incidents: z.array(IncidentSchema),
  all_incidents: z.array(IncidentSchema),
  summary: z
    .object({
      by_product: z.record(z.string(), z.number()),
      by_service: z.record(z.string(), z.number()),
      by_severity: z.record(z.string(), z.number()),
    })
    .optional(),
});

export type Incident = z.infer<typeof IncidentSchema>;
export type StatusResponse = z.infer<typeof StatusResponseSchema>;
