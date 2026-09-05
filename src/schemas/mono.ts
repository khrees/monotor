import { z } from "zod";

export const IncidentSchema = z.object({
  title: z.string(),
  description: z.string(),
  link: z.url(),
  id: z.string(),
  published_at: z.iso.datetime(),
  is_ongoing: z.boolean(),
  status: z.string().nullable(),
  products: z.array(z.string()),
  affected_services: z.array(z.string()),
  outage_type: z.string(),
  provider: z.string().nullable(),
  institution: z.string().nullable(),
  auth_method: z.enum(["mobile", "internet"]).nullable(),
  scope: z.enum(["institution", "systemic"]),
  severity: z.enum(["critical", "major", "minor", "none"]),
});

export type Incident = z.infer<typeof IncidentSchema>;
