export type Stage = {
  id: string;
  name: string;
  position: number;
  color: string;
  stage_type: "open" | "won" | "lost";
};

export type Lead = {
  id: string;
  name: string;
  company_name: string | null;
  whatsapp: string | null;
  source: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  status: "open" | "won" | "lost" | "archived";
  next_action_at: string | null;
  next_action_title: string | null;
  last_contact_at: string | null;
  stage_id: string;
  pipeline_stages: Pick<Stage, "name" | "color"> | null;
};
