
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "acks": {
                  Row: {
                    "action": Database["public"]['Enums']["ack_action"],"created_at": string,"id": string,"note": string | null,"obligation_id": string,"seq": number,"user_id": string,"version_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": Database["public"]['Enums']["ack_action"],"created_at"?: string,"id"?: string,"note"?: string | null,"obligation_id": string,"seq"?: never,"user_id": string,"version_id": string
                  }
                  Update: {
                    "action"?: Database["public"]['Enums']["ack_action"],"created_at"?: string,"id"?: string,"note"?: string | null,"obligation_id"?: string,"seq"?: never,"user_id"?: string,"version_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "acks_version_id_fkey"
      columns: ["version_id"]
isOneToOne: false
      referencedRelation: "versions"
      referencedColumns: ["id"]
    }
                  ]
                },"aliases": {
                  Row: {
                    "canonical": string,"id": string,"kind": Database["public"]['Enums']["alias_kind"],"variants": (string)[],"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "canonical": string,"id"?: string,"kind": Database["public"]['Enums']["alias_kind"],"variants"?: (string)[],"workspace_id": string
                  }
                  Update: {
                    "canonical"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["alias_kind"],"variants"?: (string)[],"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "aliases_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_log": {
                  Row: {
                    "access_level": Database["public"]['Enums']["access_level"],"action": string,"actor": string | null,"after": Json | null,"before": Json | null,"created_at": string,"id": number,"obligation_id": string | null,"private_uploaders": (string)[],"reason": string | null,"target_id": string | null,"target_type": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "access_level": Database["public"]['Enums']["access_level"],"action": string,"actor"?: string | null,"after"?: Json | null,"before"?: Json | null,"created_at"?: string,"id"?: never,"obligation_id"?: string | null,"private_uploaders"?: (string)[],"reason"?: string | null,"target_id"?: string | null,"target_type": string,"workspace_id": string
                  }
                  Update: {
                    "access_level"?: Database["public"]['Enums']["access_level"],"action"?: string,"actor"?: string | null,"after"?: Json | null,"before"?: Json | null,"created_at"?: string,"id"?: never,"obligation_id"?: string | null,"private_uploaders"?: (string)[],"reason"?: string | null,"target_id"?: string | null,"target_type"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"context_items": {
                  Row: {
                    "access_level": Database["public"]['Enums']["access_level"],"created_at": string,"event_id": string | null,"id": string,"kind": Database["public"]['Enums']["context_kind"],"obligation_id": string,"private_uploaders": (string)[],"quote": string | null,"text": string,"verified": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "access_level": Database["public"]['Enums']["access_level"],"created_at"?: string,"event_id"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["context_kind"],"obligation_id": string,"private_uploaders"?: (string)[],"quote"?: string | null,"text": string,"verified"?: boolean
                  }
                  Update: {
                    "access_level"?: Database["public"]['Enums']["access_level"],"created_at"?: string,"event_id"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["context_kind"],"obligation_id"?: string,"private_uploaders"?: (string)[],"quote"?: string | null,"text"?: string,"verified"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "context_items_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "context_items_obligation_id_fkey"
      columns: ["obligation_id"]
isOneToOne: false
      referencedRelation: "obligations"
      referencedColumns: ["id"]
    }
                  ]
                },"docket_entries": {
                  Row: {
                    "claim_a_event": string,"claim_b_event": string,"created_at": string,"id": string,"obligation_id": string | null,"origin": string,"quote_a": string | null,"quote_b": string | null,"reason": string | null,"ruled_at": string | null,"ruled_by": string | null,"ruling": string | null,"summary": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "claim_a_event": string,"claim_b_event": string,"created_at"?: string,"id"?: string,"obligation_id"?: string | null,"origin"?: string,"quote_a"?: string | null,"quote_b"?: string | null,"reason"?: string | null,"ruled_at"?: string | null,"ruled_by"?: string | null,"ruling"?: string | null,"summary": string,"workspace_id": string
                  }
                  Update: {
                    "claim_a_event"?: string,"claim_b_event"?: string,"created_at"?: string,"id"?: string,"obligation_id"?: string | null,"origin"?: string,"quote_a"?: string | null,"quote_b"?: string | null,"reason"?: string | null,"ruled_at"?: string | null,"ruled_by"?: string | null,"ruling"?: string | null,"summary"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "docket_entries_claim_a_event_fkey"
      columns: ["claim_a_event"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "docket_entries_claim_b_event_fkey"
      columns: ["claim_b_event"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "docket_entries_obligation_id_fkey"
      columns: ["obligation_id"]
isOneToOne: false
      referencedRelation: "obligations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "docket_entries_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"events": {
                  Row: {
                    "access_level": Database["public"]['Enums']["access_level"],"author": string | null,"id": string,"meta": NonNullable<Json>,"seq": number,"source_id": string,"text": string,"thread_id": string | null,"ts": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "access_level": Database["public"]['Enums']["access_level"],"author"?: string | null,"id"?: string,"meta"?: NonNullable<Json>,"seq"?: never,"source_id": string,"text": string,"thread_id"?: string | null,"ts"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "access_level"?: Database["public"]['Enums']["access_level"],"author"?: string | null,"id"?: string,"meta"?: NonNullable<Json>,"seq"?: never,"source_id"?: string,"text"?: string,"thread_id"?: string | null,"ts"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "events_source_id_fkey"
      columns: ["source_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "events_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"evidence": {
                  Row: {
                    "event_id": string,"id": string,"inferred": boolean,"obligation_id": string,"quote": string,"relation": Database["public"]['Enums']["evidence_relation"],"verified": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "event_id": string,"id"?: string,"inferred"?: boolean,"obligation_id": string,"quote": string,"relation": Database["public"]['Enums']["evidence_relation"],"verified"?: boolean
                  }
                  Update: {
                    "event_id"?: string,"id"?: string,"inferred"?: boolean,"obligation_id"?: string,"quote"?: string,"relation"?: Database["public"]['Enums']["evidence_relation"],"verified"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "evidence_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "evidence_obligation_id_fkey"
      columns: ["obligation_id"]
isOneToOne: false
      referencedRelation: "obligations"
      referencedColumns: ["id"]
    }
                  ]
                },"jobs": {
                  Row: {
                    "attempts": number,"created_at": string,"finished_at": string | null,"id": string,"kind": string,"payload": NonNullable<Json>,"result": Json | null,"started_at": string | null,"status": Database["public"]['Enums']["job_status"],"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"created_at"?: string,"finished_at"?: string | null,"id"?: string,"kind": string,"payload"?: NonNullable<Json>,"result"?: Json | null,"started_at"?: string | null,"status"?: Database["public"]['Enums']["job_status"],"workspace_id": string
                  }
                  Update: {
                    "attempts"?: number,"created_at"?: string,"finished_at"?: string | null,"id"?: string,"kind"?: string,"payload"?: NonNullable<Json>,"result"?: Json | null,"started_at"?: string | null,"status"?: Database["public"]['Enums']["job_status"],"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "jobs_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"llm_cache": {
                  Row: {
                    "created_at": string,"hash": string,"model": string | null,"response": NonNullable<Json>,"usage": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"hash": string,"model"?: string | null,"response": NonNullable<Json>,"usage"?: NonNullable<Json>
                  }
                  Update: {
                    "created_at"?: string,"hash"?: string,"model"?: string | null,"response"?: NonNullable<Json>,"usage"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"memberships": {
                  Row: {
                    "role": Database["public"]['Enums']["app_role"],"user_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "role": Database["public"]['Enums']["app_role"],"user_id": string,"workspace_id": string
                  }
                  Update: {
                    "role"?: Database["public"]['Enums']["app_role"],"user_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memberships_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"obligation_links": {
                  Row: {
                    "a": string,"b": string,"created_at": string,"created_by": string | null,"id": string,"method": string,"score": number | null,"verdict": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "a": string,"b": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"method": string,"score"?: number | null,"verdict": string,"workspace_id": string
                  }
                  Update: {
                    "a"?: string,"b"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"method"?: string,"score"?: number | null,"verdict"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "obligation_links_a_fkey"
      columns: ["a"]
isOneToOne: false
      referencedRelation: "obligations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "obligation_links_b_fkey"
      columns: ["b"]
isOneToOne: false
      referencedRelation: "obligations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "obligation_links_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"obligations": {
                  Row: {
                    "access_level": Database["public"]['Enums']["access_level"],"approval_required": string | null,"approver": string | null,"cadence": string | null,"created_at": string,"description": string,"due_date": string | null,"due_text": string | null,"fulfilment_checked_at": string | null,"id": string,"kind": Database["public"]['Enums']["obligation_kind"],"lead_time": string | null,"next_due": string | null,"next_due_basis": string | null,"owed_by": string | null,"owed_to": string | null,"period": string | null,"private_uploaders": (string)[],"review_state": Database["public"]['Enums']["review_state"],"reviewed_status": Database["public"]['Enums']["obligation_status"] | null,"reviewed_trust": Database["public"]['Enums']["trust_state"] | null,"start_by": string | null,"status": Database["public"]['Enums']["obligation_status"],"trust_state": Database["public"]['Enums']["trust_state"],"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "access_level"?: Database["public"]['Enums']["access_level"],"approval_required"?: string | null,"approver"?: string | null,"cadence"?: string | null,"created_at"?: string,"description": string,"due_date"?: string | null,"due_text"?: string | null,"fulfilment_checked_at"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["obligation_kind"],"lead_time"?: string | null,"next_due"?: string | null,"next_due_basis"?: string | null,"owed_by"?: string | null,"owed_to"?: string | null,"period"?: string | null,"private_uploaders"?: (string)[],"review_state"?: Database["public"]['Enums']["review_state"],"reviewed_status"?: Database["public"]['Enums']["obligation_status"] | null,"reviewed_trust"?: Database["public"]['Enums']["trust_state"] | null,"start_by"?: string | null,"status"?: Database["public"]['Enums']["obligation_status"],"trust_state"?: Database["public"]['Enums']["trust_state"],"workspace_id": string
                  }
                  Update: {
                    "access_level"?: Database["public"]['Enums']["access_level"],"approval_required"?: string | null,"approver"?: string | null,"cadence"?: string | null,"created_at"?: string,"description"?: string,"due_date"?: string | null,"due_text"?: string | null,"fulfilment_checked_at"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["obligation_kind"],"lead_time"?: string | null,"next_due"?: string | null,"next_due_basis"?: string | null,"owed_by"?: string | null,"owed_to"?: string | null,"period"?: string | null,"private_uploaders"?: (string)[],"review_state"?: Database["public"]['Enums']["review_state"],"reviewed_status"?: Database["public"]['Enums']["obligation_status"] | null,"reviewed_trust"?: Database["public"]['Enums']["trust_state"] | null,"start_by"?: string | null,"status"?: Database["public"]['Enums']["obligation_status"],"trust_state"?: Database["public"]['Enums']["trust_state"],"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "obligations_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"releases": {
                  Row: {
                    "created_at": string,"id": string,"reason": string,"released_by": string | null,"target_id": string,"target_type": string,"to_role": Database["public"]['Enums']["app_role"],"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"reason": string,"released_by"?: string | null,"target_id": string,"target_type": string,"to_role": Database["public"]['Enums']["app_role"],"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"reason"?: string,"released_by"?: string | null,"target_id"?: string,"target_type"?: string,"to_role"?: Database["public"]['Enums']["app_role"],"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "releases_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"review_signoffs": {
                  Row: {
                    "created_at": string,"id": string,"item_count": number,"pending_hash": string,"reason": string,"seq": number,"signed_by": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"item_count": number,"pending_hash": string,"reason": string,"seq"?: never,"signed_by"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"item_count"?: number,"pending_hash"?: string,"reason"?: string,"seq"?: never,"signed_by"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "review_signoffs_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"sealed_items": {
                  Row: {
                    "approved_by": string | null,"holder_role": Database["public"]['Enums']["app_role"],"id": string,"obligation_id": string | null,"topic_label": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_by"?: string | null,"holder_role": Database["public"]['Enums']["app_role"],"id"?: string,"obligation_id"?: string | null,"topic_label": string,"workspace_id": string
                  }
                  Update: {
                    "approved_by"?: string | null,"holder_role"?: Database["public"]['Enums']["app_role"],"id"?: string,"obligation_id"?: string | null,"topic_label"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sealed_items_obligation_id_fkey"
      columns: ["obligation_id"]
isOneToOne: false
      referencedRelation: "obligations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sealed_items_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"sources": {
                  Row: {
                    "access_level": Database["public"]['Enums']["access_level"],"event_count": number,"filename": string,"id": string,"imported_at": string,"read_summary": NonNullable<Json>,"sha256": string,"type": Database["public"]['Enums']["source_type"],"uploaded_by": string | null,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "access_level": Database["public"]['Enums']["access_level"],"event_count"?: number,"filename": string,"id"?: string,"imported_at"?: string,"read_summary"?: NonNullable<Json>,"sha256": string,"type": Database["public"]['Enums']["source_type"],"uploaded_by"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "access_level"?: Database["public"]['Enums']["access_level"],"event_count"?: number,"filename"?: string,"id"?: string,"imported_at"?: string,"read_summary"?: NonNullable<Json>,"sha256"?: string,"type"?: Database["public"]['Enums']["source_type"],"uploaded_by"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sources_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"version_context_items": {
                  Row: {
                    "access_level": Database["public"]['Enums']["access_level"],"context_item_id": string,"id": string,"kind": Database["public"]['Enums']["context_kind"],"obligation_id": string,"private_uploaders": (string)[],"quote": string | null,"text": string,"version_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "access_level": Database["public"]['Enums']["access_level"],"context_item_id": string,"id"?: string,"kind": Database["public"]['Enums']["context_kind"],"obligation_id": string,"private_uploaders"?: (string)[],"quote"?: string | null,"text": string,"version_id": string,"workspace_id": string
                  }
                  Update: {
                    "access_level"?: Database["public"]['Enums']["access_level"],"context_item_id"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["context_kind"],"obligation_id"?: string,"private_uploaders"?: (string)[],"quote"?: string | null,"text"?: string,"version_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "version_context_items_version_id_fkey"
      columns: ["version_id"]
isOneToOne: false
      referencedRelation: "versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "version_context_items_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"version_items": {
                  Row: {
                    "access_level": Database["public"]['Enums']["access_level"],"item": NonNullable<Json>,"item_format": number,"item_hash": string,"obligation_id": string,"private_uploaders": (string)[],"version_id": string,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "access_level": Database["public"]['Enums']["access_level"],"item": NonNullable<Json>,"item_format"?: number,"item_hash": string,"obligation_id": string,"private_uploaders"?: (string)[],"version_id": string,"workspace_id": string
                  }
                  Update: {
                    "access_level"?: Database["public"]['Enums']["access_level"],"item"?: NonNullable<Json>,"item_format"?: number,"item_hash"?: string,"obligation_id"?: string,"private_uploaders"?: (string)[],"version_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "version_items_version_id_fkey"
      columns: ["version_id"]
isOneToOne: false
      referencedRelation: "versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "version_items_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"versions": {
                  Row: {
                    "approved_by": string | null,"created_at": string,"diff": NonNullable<Json>,"id": string,"number": number,"snapshot": NonNullable<Json>,"workspace_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_by"?: string | null,"created_at"?: string,"diff": NonNullable<Json>,"id"?: string,"number": number,"snapshot": NonNullable<Json>,"workspace_id": string
                  }
                  Update: {
                    "approved_by"?: string | null,"created_at"?: string,"diff"?: NonNullable<Json>,"id"?: string,"number"?: number,"snapshot"?: NonNullable<Json>,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "versions_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"workspaces": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"is_demo": boolean,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"is_demo"?: boolean,"name": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"is_demo"?: boolean,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            "latest_acks": {
                  Row: {
                    "action": Database["public"]['Enums']["ack_action"],"created_at": string,"id": string,"note": string | null,"obligation_id": string,"user_id": string,"version_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "acks_version_id_fkey"
      columns: ["version_id"]
isOneToOne: false
      referencedRelation: "versions"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "add_extracted_commitment":
{ Args: { "p_deliverable": string,"p_due_text": string,"p_event": string,"p_owed_by": string,"p_owed_to": string,"p_quote": string,"p_workspace": string }; Returns: {
              "created": boolean,"obligation_id": string
            }[]
                           },
"add_recurring_duty":
{ Args: { "p_approval": string,"p_approver": string,"p_cadence": string,"p_description": string,"p_lead_time": string,"p_next_due": string,"p_next_due_basis": string,"p_owed_by": string,"p_period": string,"p_quotes": Json,"p_start_by": string,"p_workspace": string }; Returns: {
              "created": boolean,"obligation_id": string,"quotes_added": number
            }[]
                           },
"approve_version":
{ Args: { "p_reason": string,"p_workspace": string }; Returns: string
                           },
"claim_next_job":
{ Args: { "p_kind": string,"p_run": string,"p_workspace": string }; Returns: {
              "attempts": number,
"created_at": string,
"finished_at": string | null,
"id": string,
"kind": string,
"payload": NonNullable<Json>,
"result": Json | null,
"started_at": string | null,
"status": Database["public"]['Enums']["job_status"],
"workspace_id": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "jobs"
        isOneToOne: false
        isSetofReturn: true
      } },
"claim_next_run_job":
{ Args: { "p_run": string,"p_workspace": string }; Returns: {
              "attempts": number,
"created_at": string,
"finished_at": string | null,
"id": string,
"kind": string,
"payload": NonNullable<Json>,
"result": Json | null,
"started_at": string | null,
"status": Database["public"]['Enums']["job_status"],
"workspace_id": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "jobs"
        isOneToOne: false
        isSetofReturn: true
      } },
"delete_workspace":
{ Args: { "p_reason": string,"p_workspace": string }; Returns: undefined
                           },
"event_authors":
{ Args: { "p_workspace": string }; Returns: {
              "author": string,"events": number
            }[]
                           },
"import_source":
{ Args: { "p_access": Database["public"]['Enums']["access_level"],"p_events": Json,"p_filename": string,"p_reason": string,"p_sha256": string,"p_summary": Json,"p_type": Database["public"]['Enums']["source_type"],"p_workspace": string }; Returns: string
                           },
"link_obligations":
{ Args: { "p_a": string,"p_b": string,"p_method": string,"p_score": number,"p_verdict": string,"p_workspace": string }; Returns: {
              "created": boolean,"link_id": string,"verdict": string
            }[]
                           },
"mark_ready":
{ Args: { "p_reason": string,"p_workspace": string }; Returns: string
                           },
"pending_review":
{ Args: { "p_workspace": string }; Returns: {
              "item": Json,"item_hash": string,"needs_rereview": boolean,"obligation_id": string,"review_state": Database["public"]['Enums']["review_state"]
            }[]
                           },
"ping":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"record_followup":
{ Args: { "p_context": Json,"p_evidence": Json,"p_obligation": string,"p_workspace": string }; Returns: {
              "context_added": number,"duplicates": number,"evidence_added": number,"rejected": number,"status": Database["public"]['Enums']["obligation_status"]
            }[]
                           },
"release_item":
{ Args: { "p_reason": string,"p_target_id": string,"p_target_type": string,"p_to_role": Database["public"]['Enums']["app_role"] }; Returns: string
                           },
"remove_source":
{ Args: { "p_reason": string,"p_source": string }; Returns: undefined
                           },
"review_obligation":
{ Args: { "p_action": string,"p_changes"?: Json,"p_id": string,"p_reason": string }; Returns: Database["public"]['Enums']["review_state"]
                           },
"rule_conflict":
{ Args: { "p_entry": string,"p_reason": string,"p_ruling": string }; Returns: undefined
                           },
"set_link_verdict":
{ Args: { "p_a": string,"p_b": string,"p_reason": string,"p_verdict": string,"p_workspace": string }; Returns: string
                           },
"signoff_status":
{ Args: { "p_workspace": string }; Returns: {
              "is_current": boolean,"item_count": number,"marked_at": string,"marked_by": string,"reason": string
            }[]
                           }
          }
          Enums: {
            "access_level": "everyone"|"committee"|"finance"|"private","ack_action": "accept"|"question"|"decline","alias_kind": "person"|"org","app_role": "outgoing_lead"|"advisor"|"incoming_lead"|"treasurer"|"member","context_kind": "decision"|"contact"|"risk"|"dependency","evidence_relation": "supports"|"fulfils"|"contradicts"|"past_instance","job_status": "queued"|"running"|"done"|"failed","obligation_kind": "commitment"|"recurring","obligation_status": "open"|"fulfilled"|"likely_fulfilled"|"no_evidence"|"contradicted","review_state": "draft"|"accepted"|"rejected"|"edited","source_type": "whatsapp"|"trello"|"minutes","trust_state": "corroborated"|"sourced"|"inferred"|"contradicted"|"gap"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "access_level": ["everyone", "committee", "finance", "private"],"ack_action": ["accept", "question", "decline"],"alias_kind": ["person", "org"],"app_role": ["outgoing_lead", "advisor", "incoming_lead", "treasurer", "member"],"context_kind": ["decision", "contact", "risk", "dependency"],"evidence_relation": ["supports", "fulfils", "contradicts", "past_instance"],"job_status": ["queued", "running", "done", "failed"],"obligation_kind": ["commitment", "recurring"],"obligation_status": ["open", "fulfilled", "likely_fulfilled", "no_evidence", "contradicted"],"review_state": ["draft", "accepted", "rejected", "edited"],"source_type": ["whatsapp", "trello", "minutes"],"trust_state": ["corroborated", "sourced", "inferred", "contradicted", "gap"]
          }
        }
} as const
