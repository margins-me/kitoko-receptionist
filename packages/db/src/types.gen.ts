
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "agent_events": {
                  Row: {
                    "booking_id": string | null,"conversation_id": string | null,"created_at": string,"id": number,"input": Json | null,"kind": string,"ms": number | null,"name": string,"output": Json | null,"pro_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "booking_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"id"?: never,"input"?: Json | null,"kind"?: string,"ms"?: number | null,"name": string,"output"?: Json | null,"pro_id"?: string | null
                  }
                  Update: {
                    "booking_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"id"?: never,"input"?: Json | null,"kind"?: string,"ms"?: number | null,"name"?: string,"output"?: Json | null,"pro_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "agent_events_booking_id_fkey"
      columns: ["booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agent_events_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "agent_events_pro_id_fkey"
      columns: ["pro_id"]
isOneToOne: false
      referencedRelation: "pros"
      referencedColumns: ["id"]
    }
                  ]
                },"blocks": {
                  Row: {
                    "created_at": string,"during": unknown,"id": string,"label": string | null,"pro_id": string,"staff_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"during": unknown,"id"?: string,"label"?: string | null,"pro_id": string,"staff_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"during"?: unknown,"id"?: string,"label"?: string | null,"pro_id"?: string,"staff_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "blocks_pro_id_fkey"
      columns: ["pro_id"]
isOneToOne: false
      referencedRelation: "pros"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "blocks_pro_id_staff_id_fkey"
      columns: ["pro_id","staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["pro_id","id"]
    }
                  ]
                },"bookings": {
                  Row: {
                    "cancel_reason": string | null,"cancelled_at": string | null,"cancelled_by": string | null,"client_id": string | null,"conversation_id": string | null,"created_at": string,"currency": string,"deposit_cents": number,"displaced_at": string | null,"during": unknown,"fee_cents": number,"hold_expires_at": string | null,"hold_refreshed_at": string | null,"id": string,"locale": string,"moved_by": string | null,"moved_from": string | null,"policy": NonNullable<Json>,"price_cents": number,"pro_id": string,"ref": string,"reschedule_count": number,"selection": NonNullable<Json>,"service_id": string,"source": string,"staff_id": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cancel_reason"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"client_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"currency": string,"deposit_cents": number,"displaced_at"?: string | null,"during": unknown,"fee_cents"?: number,"hold_expires_at"?: string | null,"hold_refreshed_at"?: string | null,"id"?: string,"locale"?: string,"moved_by"?: string | null,"moved_from"?: string | null,"policy": NonNullable<Json>,"price_cents": number,"pro_id": string,"ref"?: string,"reschedule_count"?: number,"selection": NonNullable<Json>,"service_id": string,"source": string,"staff_id": string,"status": string,"updated_at"?: string
                  }
                  Update: {
                    "cancel_reason"?: string | null,"cancelled_at"?: string | null,"cancelled_by"?: string | null,"client_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"currency"?: string,"deposit_cents"?: number,"displaced_at"?: string | null,"during"?: unknown,"fee_cents"?: number,"hold_expires_at"?: string | null,"hold_refreshed_at"?: string | null,"id"?: string,"locale"?: string,"moved_by"?: string | null,"moved_from"?: string | null,"policy"?: NonNullable<Json>,"price_cents"?: number,"pro_id"?: string,"ref"?: string,"reschedule_count"?: number,"selection"?: NonNullable<Json>,"service_id"?: string,"source"?: string,"staff_id"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "bookings_conversation_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bookings_pro_id_client_id_fkey"
      columns: ["pro_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["pro_id","id"]
    },{
      foreignKeyName: "bookings_pro_id_fkey"
      columns: ["pro_id"]
isOneToOne: false
      referencedRelation: "pros"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "bookings_pro_id_service_id_fkey"
      columns: ["pro_id","service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["pro_id","id"]
    },{
      foreignKeyName: "bookings_pro_id_staff_id_fkey"
      columns: ["pro_id","staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["pro_id","id"]
    }
                  ]
                },"categories": {
                  Row: {
                    "id": string,"name": string,"position": number,"pro_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"name": string,"position"?: number,"pro_id": string
                  }
                  Update: {
                    "id"?: string,"name"?: string,"position"?: number,"pro_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "categories_pro_id_fkey"
      columns: ["pro_id"]
isOneToOne: false
      referencedRelation: "pros"
      referencedColumns: ["id"]
    }
                  ]
                },"clients": {
                  Row: {
                    "created_at": string,"email": string | null,"first_name": string,"id": string,"locale": string,"notes": string | null,"phone_e164": string | null,"pro_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email"?: string | null,"first_name": string,"id"?: string,"locale"?: string,"notes"?: string | null,"phone_e164"?: string | null,"pro_id": string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string | null,"first_name"?: string,"id"?: string,"locale"?: string,"notes"?: string | null,"phone_e164"?: string | null,"pro_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "clients_pro_id_fkey"
      columns: ["pro_id"]
isOneToOne: false
      referencedRelation: "pros"
      referencedColumns: ["id"]
    }
                  ]
                },"conversation_messages": {
                  Row: {
                    "content": NonNullable<Json>,"conversation_id": string,"created_at": string,"id": number,"pro_id": string | null,"role": string,"visible": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "content": NonNullable<Json>,"conversation_id": string,"created_at"?: string,"id"?: never,"pro_id"?: string | null,"role": string,"visible"?: boolean
                  }
                  Update: {
                    "content"?: NonNullable<Json>,"conversation_id"?: string,"created_at"?: string,"id"?: never,"pro_id"?: string | null,"role"?: string,"visible"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversation_messages_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conversation_messages_pro_id_fkey"
      columns: ["pro_id"]
isOneToOne: false
      referencedRelation: "pros"
      referencedColumns: ["id"]
    }
                  ]
                },"conversations": {
                  Row: {
                    "channel": string,"client_id": string | null,"created_at": string,"external_id": string,"id": string,"kind": string,"last_message_at": string | null,"locale": string,"pro_id": string,"token": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channel": string,"client_id"?: string | null,"created_at"?: string,"external_id": string,"id"?: string,"kind": string,"last_message_at"?: string | null,"locale"?: string,"pro_id": string,"token"?: string,"updated_at"?: string
                  }
                  Update: {
                    "channel"?: string,"client_id"?: string | null,"created_at"?: string,"external_id"?: string,"id"?: string,"kind"?: string,"last_message_at"?: string | null,"locale"?: string,"pro_id"?: string,"token"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversations_pro_id_client_id_fkey"
      columns: ["pro_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["pro_id","id"]
    },{
      foreignKeyName: "conversations_pro_id_fkey"
      columns: ["pro_id"]
isOneToOne: false
      referencedRelation: "pros"
      referencedColumns: ["id"]
    }
                  ]
                },"day_overrides": {
                  Row: {
                    "day": string,"hours": Json | null,"pro_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "day": string,"hours"?: Json | null,"pro_id": string
                  }
                  Update: {
                    "day"?: string,"hours"?: Json | null,"pro_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "day_overrides_pro_id_fkey"
      columns: ["pro_id"]
isOneToOne: false
      referencedRelation: "pros"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount_cents": number,"booking_id": string,"capture_declines": number,"capture_id": string | null,"captured_at": string | null,"created_at": string,"currency": string,"deposit_cents": number,"fee_cents": number,"id": string,"kind": string,"payer": Json | null,"paypal_order_id": string,"pro_id": string,"refunded_cents": number,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"booking_id": string,"capture_declines"?: number,"capture_id"?: string | null,"captured_at"?: string | null,"created_at"?: string,"currency": string,"deposit_cents"?: number,"fee_cents"?: number,"id"?: string,"kind"?: string,"payer"?: Json | null,"paypal_order_id": string,"pro_id": string,"refunded_cents"?: number,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "amount_cents"?: number,"booking_id"?: string,"capture_declines"?: number,"capture_id"?: string | null,"captured_at"?: string | null,"created_at"?: string,"currency"?: string,"deposit_cents"?: number,"fee_cents"?: number,"id"?: string,"kind"?: string,"payer"?: Json | null,"paypal_order_id"?: string,"pro_id"?: string,"refunded_cents"?: number,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_pro_id_booking_id_fkey"
      columns: ["pro_id","booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["pro_id","id"]
    },{
      foreignKeyName: "payments_pro_id_fkey"
      columns: ["pro_id"]
isOneToOne: false
      referencedRelation: "pros"
      referencedColumns: ["id"]
    }
                  ]
                },"payouts": {
                  Row: {
                    "amount_cents": number,"booking_id": string,"created_at": string,"currency": string,"fee_cents": number,"id": string,"payout_batch_id": string | null,"payout_item_id": string | null,"pro_id": string,"reason": string,"sent_at": string | null,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"booking_id": string,"created_at"?: string,"currency": string,"fee_cents"?: number,"id"?: string,"payout_batch_id"?: string | null,"payout_item_id"?: string | null,"pro_id": string,"reason": string,"sent_at"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "amount_cents"?: number,"booking_id"?: string,"created_at"?: string,"currency"?: string,"fee_cents"?: number,"id"?: string,"payout_batch_id"?: string | null,"payout_item_id"?: string | null,"pro_id"?: string,"reason"?: string,"sent_at"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payouts_pro_id_booking_id_fkey"
      columns: ["pro_id","booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["pro_id","id"]
    },{
      foreignKeyName: "payouts_pro_id_fkey"
      columns: ["pro_id"]
isOneToOne: false
      referencedRelation: "pros"
      referencedColumns: ["id"]
    }
                  ]
                },"paypal_events": {
                  Row: {
                    "event_id": string,"payload": NonNullable<Json>,"processed_at": string | null,"received_at": string,"resource_id": string | null,"type": string,"verified": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "event_id": string,"payload": NonNullable<Json>,"processed_at"?: string | null,"received_at"?: string,"resource_id"?: string | null,"type": string,"verified"?: boolean
                  }
                  Update: {
                    "event_id"?: string,"payload"?: NonNullable<Json>,"processed_at"?: string | null,"received_at"?: string,"resource_id"?: string | null,"type"?: string,"verified"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"pending_actions": {
                  Row: {
                    "amount_cents": number | null,"booking_id": string | null,"conversation_id": string | null,"created_at": string,"currency": string | null,"decided_at": string | null,"id": string,"kind": string,"payload": NonNullable<Json>,"pro_id": string,"result": Json | null,"status": string,"summary": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents"?: number | null,"booking_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"currency"?: string | null,"decided_at"?: string | null,"id"?: string,"kind": string,"payload"?: NonNullable<Json>,"pro_id": string,"result"?: Json | null,"status"?: string,"summary": string,"updated_at"?: string
                  }
                  Update: {
                    "amount_cents"?: number | null,"booking_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"currency"?: string | null,"decided_at"?: string | null,"id"?: string,"kind"?: string,"payload"?: NonNullable<Json>,"pro_id"?: string,"result"?: Json | null,"status"?: string,"summary"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pending_actions_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pending_actions_pro_id_booking_id_fkey"
      columns: ["pro_id","booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["pro_id","id"]
    },{
      foreignKeyName: "pending_actions_pro_id_fkey"
      columns: ["pro_id"]
isOneToOne: false
      referencedRelation: "pros"
      referencedColumns: ["id"]
    }
                  ]
                },"pros": {
                  Row: {
                    "address": Json | null,"area_label": string | null,"avatar_path": string | null,"bio": string | null,"city": string | null,"cover_focal_x": number,"cover_focal_y": number,"cover_height": number | null,"cover_path": string | null,"cover_width": number | null,"created_at": string,"currency": string,"gallery": (string)[],"handle": string,"hide_address": boolean,"id": string,"instagram": string | null,"layout": string | null,"locale": string,"name": string,"page_locale": string,"paypal_email": string | null,"published_at": string | null,"rules": NonNullable<Json>,"schedule": NonNullable<Json>,"style": string,"theme": string,"timezone": string,"title_font": string | null,"trades": (string)[],"updated_at": string,"whatsapp_e164": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "address"?: Json | null,"area_label"?: string | null,"avatar_path"?: string | null,"bio"?: string | null,"city"?: string | null,"cover_focal_x"?: number,"cover_focal_y"?: number,"cover_height"?: number | null,"cover_path"?: string | null,"cover_width"?: number | null,"created_at"?: string,"currency"?: string,"gallery"?: (string)[],"handle": string,"hide_address"?: boolean,"id": string,"instagram"?: string | null,"layout"?: string | null,"locale"?: string,"name": string,"page_locale"?: string,"paypal_email"?: string | null,"published_at"?: string | null,"rules": NonNullable<Json>,"schedule": NonNullable<Json>,"style"?: string,"theme"?: string,"timezone"?: string,"title_font"?: string | null,"trades"?: (string)[],"updated_at"?: string,"whatsapp_e164"?: string | null
                  }
                  Update: {
                    "address"?: Json | null,"area_label"?: string | null,"avatar_path"?: string | null,"bio"?: string | null,"city"?: string | null,"cover_focal_x"?: number,"cover_focal_y"?: number,"cover_height"?: number | null,"cover_path"?: string | null,"cover_width"?: number | null,"created_at"?: string,"currency"?: string,"gallery"?: (string)[],"handle"?: string,"hide_address"?: boolean,"id"?: string,"instagram"?: string | null,"layout"?: string | null,"locale"?: string,"name"?: string,"page_locale"?: string,"paypal_email"?: string | null,"published_at"?: string | null,"rules"?: NonNullable<Json>,"schedule"?: NonNullable<Json>,"style"?: string,"theme"?: string,"timezone"?: string,"title_font"?: string | null,"trades"?: (string)[],"updated_at"?: string,"whatsapp_e164"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"refunds": {
                  Row: {
                    "amount_cents": number,"booking_id": string,"created_at": string,"currency": string,"id": string,"payment_id": string,"paypal_refund_id": string | null,"pro_id": string,"reason": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"booking_id": string,"created_at"?: string,"currency": string,"id"?: string,"payment_id": string,"paypal_refund_id"?: string | null,"pro_id": string,"reason": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "amount_cents"?: number,"booking_id"?: string,"created_at"?: string,"currency"?: string,"id"?: string,"payment_id"?: string,"paypal_refund_id"?: string | null,"pro_id"?: string,"reason"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "refunds_pro_id_booking_id_fkey"
      columns: ["pro_id","booking_id"]
isOneToOne: false
      referencedRelation: "bookings"
      referencedColumns: ["pro_id","id"]
    },{
      foreignKeyName: "refunds_pro_id_fkey"
      columns: ["pro_id"]
isOneToOne: false
      referencedRelation: "pros"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "refunds_pro_id_payment_id_fkey"
      columns: ["pro_id","payment_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["pro_id","id"]
    }
                  ]
                },"service_staff": {
                  Row: {
                    "pro_id": string,"service_id": string,"staff_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "pro_id": string,"service_id": string,"staff_id": string
                  }
                  Update: {
                    "pro_id"?: string,"service_id"?: string,"staff_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "service_staff_pro_id_service_id_fkey"
      columns: ["pro_id","service_id"]
isOneToOne: false
      referencedRelation: "services"
      referencedColumns: ["pro_id","id"]
    },{
      foreignKeyName: "service_staff_pro_id_staff_id_fkey"
      columns: ["pro_id","staff_id"]
isOneToOne: false
      referencedRelation: "staff"
      referencedColumns: ["pro_id","id"]
    }
                  ]
                },"services": {
                  Row: {
                    "active": boolean,"addons": NonNullable<Json>,"base_minutes": number,"base_price_cents": number,"category_id": string | null,"conditions": NonNullable<Json>,"deposit": Json | null,"description": string | null,"id": string,"name": string,"option_groups": NonNullable<Json>,"photos": (string)[],"position": number,"prep_instructions": string | null,"pro_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"addons"?: NonNullable<Json>,"base_minutes": number,"base_price_cents": number,"category_id"?: string | null,"conditions"?: NonNullable<Json>,"deposit"?: Json | null,"description"?: string | null,"id"?: string,"name": string,"option_groups"?: NonNullable<Json>,"photos"?: (string)[],"position"?: number,"prep_instructions"?: string | null,"pro_id": string
                  }
                  Update: {
                    "active"?: boolean,"addons"?: NonNullable<Json>,"base_minutes"?: number,"base_price_cents"?: number,"category_id"?: string | null,"conditions"?: NonNullable<Json>,"deposit"?: Json | null,"description"?: string | null,"id"?: string,"name"?: string,"option_groups"?: NonNullable<Json>,"photos"?: (string)[],"position"?: number,"prep_instructions"?: string | null,"pro_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "services_pro_id_category_id_fkey"
      columns: ["pro_id","category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["pro_id","id"]
    },{
      foreignKeyName: "services_pro_id_fkey"
      columns: ["pro_id"]
isOneToOne: false
      referencedRelation: "pros"
      referencedColumns: ["id"]
    }
                  ]
                },"staff": {
                  Row: {
                    "color": string | null,"id": string,"name": string,"position": number,"pro_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "color"?: string | null,"id"?: string,"name": string,"position"?: number,"pro_id": string
                  }
                  Update: {
                    "color"?: string | null,"id"?: string,"name"?: string,"position"?: number,"pro_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_pro_id_fkey"
      columns: ["pro_id"]
isOneToOne: false
      referencedRelation: "pros"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "block_time":
{ Args: { "p_during"?: unknown,"p_label"?: string,"p_pro_id": string,"p_staff_id"?: string }; Returns: string[]
                           },
"busy_intervals":
{ Args: { "p_from"?: string,"p_pro_id": string,"p_staff_id"?: string,"p_to"?: string }; Returns: {
              "during": unknown,"staff_id": string
            }[]
                           },
"cancel_booking":
{ Args: { "p_booking_id": string,"p_by": string,"p_reason"?: string }; Returns: {
              "kept_cents": number,"refund_cents": number
            }[]
                           },
"confirm_booking":
{ Args: { "p_booking_id": string,"p_email"?: string,"p_first_name": string,"p_locale"?: string,"p_phone"?: string }; Returns: string
                           },
"create_hold":
{ Args: { "p_conversation_id"?: string,"p_deposit_cents"?: number,"p_fee_cents"?: number,"p_locale"?: string,"p_minutes"?: number,"p_policy"?: Json,"p_price_cents"?: number,"p_pro_id": string,"p_selection"?: Json,"p_service_id": string,"p_source"?: string,"p_staff_id"?: string,"p_start"?: string }; Returns: {
              "hold_expires_at": string,"id": string,"ref": string,"staff_id": string
            }[]
                           },
"decide_pending_action":
{ Args: { "p_decision": string,"p_id": string }; Returns: {
              "amount_cents": number | null,
"booking_id": string | null,
"conversation_id": string | null,
"created_at": string,
"currency": string | null,
"decided_at": string | null,
"id": string,
"kind": string,
"payload": NonNullable<Json>,
"pro_id": string,
"result": Json | null,
"status": string,
"summary": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "pending_actions"
        isOneToOne: true
        isSetofReturn: false
      } },
"is_live":
{ Args: { "p_pro_id": string }; Returns: boolean
                           },
"mark_honoured":
{ Args: { "p_booking_id": string }; Returns: string
                           },
"mark_no_show":
{ Args: { "p_booking_id": string }; Returns: string
                           },
"payout_sent":
{ Args: { "p_batch_id": string,"p_item_id": string,"p_payout_id": string }; Returns: undefined
                           },
"payout_status":
{ Args: { "p_item_id": string,"p_status": string }; Returns: undefined
                           },
"paypal_capture_completed":
{ Args: { "p_amount_cents": number,"p_capture_id": string,"p_currency": string,"p_order_id": string,"p_payer"?: Json }; Returns: {
              "booking_id": string,"outcome": string,"payment_id": string
            }[]
                           },
"paypal_capture_declined":
{ Args: { "p_order_id": string }; Returns: number
                           },
"paypal_capture_denied":
{ Args: { "p_order_id": string }; Returns: undefined
                           },
"paypal_prepare":
{ Args: { "p_booking_id": string,"p_order_id": string }; Returns: string
                           },
"preview_cancel":
{ Args: { "p_booking_id": string,"p_by": string }; Returns: {
              "fee_kept_cents": number,"kept_cents": number,"refund_cents": number
            }[]
                           },
"record_paypal_event":
{ Args: { "p_event_id": string,"p_payload"?: Json,"p_resource_id"?: string,"p_type": string,"p_verified"?: boolean }; Returns: boolean
                           },
"refresh_hold_on_open":
{ Args: { "p_booking_id": string }; Returns: string
                           },
"refund_finished":
{ Args: { "p_paypal_refund_id"?: string,"p_refund_id": string,"p_status"?: string }; Returns: undefined
                           },
"release_hold":
{ Args: { "p_booking_id": string }; Returns: undefined
                           },
"request_refund":
{ Args: { "p_amount_cents": number,"p_payment_id": string,"p_reason"?: string }; Returns: string
                           },
"reschedule_booking":
{ Args: { "p_booking_id": string,"p_by": string,"p_start": string }; Returns: string
                           },
"reset_demo":
{ Args: { "p_pro_id": string }; Returns: undefined
                           }
          }
          Enums: {
            [_ in never]: never
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
            
          }
        }
} as const
