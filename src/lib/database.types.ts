// Tipos do banco. Escrito conforme supabase/migrations; regenere com:
//   npx supabase gen types typescript --local > src/lib/database.types.ts
// (ou --project-id <id> quando usar o projeto na nuvem)

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type UserRole = "admin" | "gestor" | "colaborador";
type Department = "contabil" | "fiscal" | "dp" | "atendimento";
type ClientStatus = "ativo" | "suspenso" | "encerrado";
type TaxRegime = "mei" | "simples_nacional" | "lucro_presumido" | "lucro_real" | "outro";
type TicketStatus = "aberto" | "em_andamento" | "aguardando_cliente" | "concluido" | "cancelado";
type TicketPriority = "baixa" | "normal" | "alta" | "urgente";
type TicketOrigin = "whatsapp" | "telefone" | "email" | "presencial" | "interno";
type SlaUnit = "horas_uteis" | "dias_uteis";
type TicketEventKind = "criado" | "comentario" | "resposta" | "status" | "atribuicao" | "encaminhamento" | "prioridade" | "categoria";
type DocPeriodicity = "mensal" | "trimestral" | "semestral" | "anual";
type DocStatus = "pendente" | "recebido" | "dispensado" | "nao_exigivel";
type ReminderChannel = "interno" | "whatsapp";
type ReminderStatus = "na_fila" | "enviado" | "falhou" | "cancelado" | "sem_canal";

type Rel = { foreignKeyName: string; columns: string[]; isOneToOne: boolean; referencedRelation: string; referencedColumns: string[] };
/** Atalho para tabelas da Etapa 3: Row completo, Insert com obrigatórios, Update parcial. */
type TableDef<R, Req extends keyof R, Rels extends Rel[] = []> = {
  Row: R;
  Insert: Partial<R> & Pick<R, Req>;
  Update: Partial<R>;
  Relationships: Rels;
};

type SlaSettingsRow = {
  id: number; timezone: string; work_start: string; work_end: string; workdays: number[];
  risk_percent: number; default_first_response_minutes: number; needs_review: boolean; updated_at: string;
};
type HolidayRow = { day: string; name: string; scope: "nacional" | "estadual" | "municipal" | "empresa"; created_at: string };
type TicketCategoryRow = {
  id: string; name: string; department: Department; first_response_minutes: number | null;
  resolution_value: number; resolution_unit: SlaUnit; active: boolean; needs_review: boolean;
  created_at: string; updated_at: string;
};
type TicketRow = {
  id: string; number: number; client_id: string; title: string; description: string | null;
  origin: TicketOrigin; category_id: string; department: Department; assignee_id: string | null;
  priority: TicketPriority; status: TicketStatus; created_by: string | null; created_at: string; updated_at: string;
  first_response_due_at: string | null; first_responded_at: string | null; resolution_due_at: string | null;
  risk_at: string | null; sla_paused_at: string | null; sla_paused_minutes: number;
  resolved_at: string | null; closed_at: string | null; closed_by: string | null;
  resolution_note: string | null; cancel_reason: string | null;
  fr_overdue_notified_at: string | null; risk_notified_at: string | null; overdue_notified_at: string | null;
};
type TicketEventRow = {
  id: number; ticket_id: string; kind: TicketEventKind; actor_id: string | null; body: string | null;
  data: Json | null; mentions: string[]; created_at: string;
};
type NotificationRow = {
  id: number; user_id: string; ticket_id: string | null; document_id: string | null; kind: string; title: string; body: string | null;
  link: string | null; dedupe_key: string; read_at: string | null; created_at: string;
};
type ChannelKind = "whatsapp" | "email";
type ChannelStatus = "pendente" | "conectado" | "erro" | "desconectado";
type MessageDirection = "entrada" | "saida";
type MessageStatus = "recebida" | "enviando" | "enviada" | "entregue" | "lida" | "falhou";
type ChannelAccountRow = {
  id: string; kind: ChannelKind; label: string; address: string | null; status: ChannelStatus; config: Json;
  last_sync_at: string | null; last_error: string | null; is_demo: boolean; connected_by: string | null;
  sync_lock_until: string | null; created_at: string; updated_at: string;
};
type ChannelSecretRow = { account_id: string; ciphertext: string; updated_at: string };
type ConversationRow = {
  id: string; account_id: string; kind: ChannelKind; contact_address: string; contact_name: string | null;
  client_id: string | null; contact_id: string | null; last_message_at: string | null; last_preview: string | null;
  last_inbound_at: string | null; unread_count: number; archived: boolean; is_demo: boolean; created_at: string; updated_at: string;
  /** Somente e-mail: cliente | empresa | pessoa | separado (promoções e avisos automáticos) */
  category: "cliente" | "empresa" | "pessoa" | "separado" | null;
};
type EmailSenderRuleRow = { pattern: string; category: "cliente" | "empresa" | "pessoa" | "separado"; created_by: string | null; created_at: string };
type MessageRow = {
  id: string; conversation_id: string; account_id: string; direction: MessageDirection; external_id: string | null;
  kind: string; subject: string | null; body: string | null; media: Json | null; status: MessageStatus; error: string | null;
  sent_by: string | null; via: string | null; sent_at: string; created_at: string;
};
type MessageSaveRow = {
  id: string; message_id: string | null; client_id: string; channel: ChannelKind; direction: MessageDirection;
  sender: string | null; subject: string | null; body: string | null; sent_at: string; note: string | null;
  saved_by: string | null; created_at: string;
};
type WebhookEventRow = {
  id: number; source: "whatsapp" | "email"; payload: Json; signature_ok: boolean; received_at: string;
  processed_at: string | null; attempts: number; error: string | null;
};
type UserPreferencesRow = {
  user_id: string; theme: string; font_scale: string; language: string; date_format: string;
  time_format: string; timezone: string; currency: string; updated_at: string;
};
type DocumentSettingsRow ={ id: number; reminder_days: number[]; generate_ahead_days: number; updated_at: string };
type DocumentTypeRow = {
  id: string; name: string; department: Department; description: string | null; default_periodicity: DocPeriodicity;
  default_due_day: number; active: boolean; needs_review: boolean; created_at: string; updated_at: string;
};
type DocumentRequirementRow = {
  id: string; client_id: string; document_type_id: string; department: Department; periodicity: DocPeriodicity;
  due_day: number; first_month: number | null; responsible_id: string | null; starts_on: string; ends_on: string | null;
  active: boolean; notes: string | null; created_by: string | null; created_at: string; updated_at: string;
};
type ClientDocumentRow = {
  id: string; client_id: string; requirement_id: string | null; document_type_id: string; title: string; department: Department;
  due_date: string; status: DocStatus; responsible_id: string | null; received_at: string | null; received_by: string | null;
  status_note: string | null; auto_voided: boolean; overdue_notified_at: string | null; created_by: string | null;
  created_at: string; updated_at: string;
};
type DocumentReminderRow = {
  id: number; document_id: string; client_id: string; days_before: number; due_date: string; channel: ReminderChannel;
  status: ReminderStatus; recipient: string | null; attempts: number; last_error: string | null; sent_at: string | null;
  created_at: string; updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string;
          email: string;
          role: UserRole;
          department: Department | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name: string;
          email: string;
          role?: UserRole;
          department?: Department | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string;
          email?: string;
          role?: UserRole;
          department?: Department | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      clients: {
        Row: {
          id: string;
          legal_name: string;
          trade_name: string | null;
          cnpj: string;
          tax_regime: TaxRegime;
          status: ClientStatus;
          email: string | null;
          phone: string | null;
          address: string | null;
          notes: string | null;
          client_since: string | null;
          is_demo: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          legal_name: string;
          trade_name?: string | null;
          cnpj: string;
          tax_regime?: TaxRegime;
          status?: ClientStatus;
          email?: string | null;
          phone?: string | null;
          address?: string | null;
          notes?: string | null;
          client_since?: string | null;
          is_demo?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          legal_name?: string;
          trade_name?: string | null;
          cnpj?: string;
          tax_regime?: TaxRegime;
          status?: ClientStatus;
          email?: string | null;
          phone?: string | null;
          address?: string | null;
          notes?: string | null;
          client_since?: string | null;
          is_demo?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "clients_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      client_contacts: {
        Row: {
          id: string;
          client_id: string;
          name: string;
          job_title: string | null;
          email: string | null;
          whatsapp: string | null;
          is_primary: boolean;
          whatsapp_opt_in: boolean;
          whatsapp_opt_in_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          name: string;
          job_title?: string | null;
          email?: string | null;
          whatsapp?: string | null;
          is_primary?: boolean;
          whatsapp_opt_in?: boolean;
          whatsapp_opt_in_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          name?: string;
          job_title?: string | null;
          email?: string | null;
          whatsapp?: string | null;
          is_primary?: boolean;
          whatsapp_opt_in?: boolean;
          whatsapp_opt_in_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_contacts_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      client_services: {
        Row: {
          id: string;
          client_id: string;
          department: Department;
          description: string;
          started_on: string | null;
          ended_on: string | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          department: Department;
          description: string;
          started_on?: string | null;
          ended_on?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          department?: Department;
          description?: string;
          started_on?: string | null;
          ended_on?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_services_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      client_responsibles: {
        Row: {
          client_id: string;
          department: Department;
          user_id: string;
          created_at: string;
        };
        Insert: {
          client_id: string;
          department: Department;
          user_id: string;
          created_at?: string;
        };
        Update: {
          client_id?: string;
          department?: Department;
          user_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_responsibles_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_responsibles_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          id: number;
          table_name: string;
          record_id: string;
          action: string;
          actor_id: string | null;
          old_data: Json | null;
          new_data: Json | null;
          created_at: string;
        };
        Insert: {
          id?: never;
          table_name: string;
          record_id: string;
          action: string;
          actor_id?: string | null;
          old_data?: Json | null;
          new_data?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: never;
          table_name?: string;
          record_id?: string;
          action?: string;
          actor_id?: string | null;
          old_data?: Json | null;
          new_data?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      // ---------- Etapa 3 ----------
      sla_settings: TableDef<SlaSettingsRow, "id">;
      holidays: TableDef<HolidayRow, "day" | "name">;
      ticket_categories: TableDef<TicketCategoryRow, "name" | "department" | "resolution_value" | "resolution_unit">;
      tickets: TableDef<
        TicketRow,
        "client_id" | "title" | "category_id",
        [
          { foreignKeyName: "tickets_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] },
          { foreignKeyName: "tickets_category_id_fkey"; columns: ["category_id"]; isOneToOne: false; referencedRelation: "ticket_categories"; referencedColumns: ["id"] },
          { foreignKeyName: "tickets_assignee_id_fkey"; columns: ["assignee_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "tickets_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "tickets_closed_by_fkey"; columns: ["closed_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      >;
      ticket_events: TableDef<
        TicketEventRow,
        "ticket_id" | "kind",
        [
          { foreignKeyName: "ticket_events_ticket_id_fkey"; columns: ["ticket_id"]; isOneToOne: false; referencedRelation: "tickets"; referencedColumns: ["id"] },
          { foreignKeyName: "ticket_events_actor_id_fkey"; columns: ["actor_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      >;
      notifications: TableDef<
        NotificationRow,
        "user_id" | "kind" | "title" | "dedupe_key",
        [
          { foreignKeyName: "notifications_ticket_id_fkey"; columns: ["ticket_id"]; isOneToOne: false; referencedRelation: "tickets"; referencedColumns: ["id"] },
          { foreignKeyName: "notifications_document_id_fkey"; columns: ["document_id"]; isOneToOne: false; referencedRelation: "client_documents"; referencedColumns: ["id"] },
        ]
      >;
      user_preferences: TableDef<
        UserPreferencesRow,
        "user_id",
        [{ foreignKeyName: "user_preferences_user_id_fkey"; columns: ["user_id"]; isOneToOne: true; referencedRelation: "profiles"; referencedColumns: ["id"] }]
      >;
      // ---------- Etapa 4 (conversas) ----------
      channel_accounts: TableDef<ChannelAccountRow, "kind" | "label">;
      channel_secrets: TableDef<ChannelSecretRow, "account_id" | "ciphertext">;
      conversations: TableDef<
        ConversationRow,
        "account_id" | "kind" | "contact_address",
        [
          { foreignKeyName: "conversations_account_id_fkey"; columns: ["account_id"]; isOneToOne: false; referencedRelation: "channel_accounts"; referencedColumns: ["id"] },
          { foreignKeyName: "conversations_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] },
          { foreignKeyName: "conversations_contact_id_fkey"; columns: ["contact_id"]; isOneToOne: false; referencedRelation: "client_contacts"; referencedColumns: ["id"] },
        ]
      >;
      messages: TableDef<
        MessageRow,
        "conversation_id" | "account_id" | "direction" | "status",
        [
          { foreignKeyName: "messages_conversation_id_fkey"; columns: ["conversation_id"]; isOneToOne: false; referencedRelation: "conversations"; referencedColumns: ["id"] },
          { foreignKeyName: "messages_sent_by_fkey"; columns: ["sent_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      >;
      message_saves: TableDef<
        MessageSaveRow,
        "client_id" | "channel" | "direction" | "sent_at",
        [
          { foreignKeyName: "message_saves_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] },
          { foreignKeyName: "message_saves_saved_by_fkey"; columns: ["saved_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      >;
      webhook_events: TableDef<WebhookEventRow, "source" | "payload" | "signature_ok">;
      email_sender_rules: TableDef<EmailSenderRuleRow, "pattern" | "category">;
      // ---------- Etapa 3 (documentos) ----------
      document_settings: TableDef<DocumentSettingsRow, "id">;
      document_types: TableDef<DocumentTypeRow, "name" | "department">;
      document_requirements: TableDef<
        DocumentRequirementRow,
        "client_id" | "document_type_id" | "periodicity" | "due_day",
        [
          { foreignKeyName: "document_requirements_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] },
          { foreignKeyName: "document_requirements_document_type_id_fkey"; columns: ["document_type_id"]; isOneToOne: false; referencedRelation: "document_types"; referencedColumns: ["id"] },
          { foreignKeyName: "document_requirements_responsible_id_fkey"; columns: ["responsible_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      >;
      client_documents: TableDef<
        ClientDocumentRow,
        "client_id" | "document_type_id" | "due_date",
        [
          { foreignKeyName: "client_documents_client_id_fkey"; columns: ["client_id"]; isOneToOne: false; referencedRelation: "clients"; referencedColumns: ["id"] },
          { foreignKeyName: "client_documents_document_type_id_fkey"; columns: ["document_type_id"]; isOneToOne: false; referencedRelation: "document_types"; referencedColumns: ["id"] },
          { foreignKeyName: "client_documents_requirement_id_fkey"; columns: ["requirement_id"]; isOneToOne: false; referencedRelation: "document_requirements"; referencedColumns: ["id"] },
          { foreignKeyName: "client_documents_responsible_id_fkey"; columns: ["responsible_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "client_documents_received_by_fkey"; columns: ["received_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "client_documents_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      >;
      document_reminders: TableDef<
        DocumentReminderRow,
        "document_id" | "client_id" | "days_before" | "due_date" | "channel" | "status",
        [{ foreignKeyName: "document_reminders_document_id_fkey"; columns: ["document_id"]; isOneToOne: false; referencedRelation: "client_documents"; referencedColumns: ["id"] }]
      >;
    };
    Views: { [_ in never]: never };
    Functions: {
      can_view_client: { Args: { p_client_id: string }; Returns: boolean };
      is_admin: { Args: never; Returns: boolean };
      is_manager: { Args: never; Returns: boolean };
      is_valid_cnpj: { Args: { cnpj: string }; Returns: boolean };
      sla_preview: { Args: { p_category: string }; Returns: { first_response_due: string; resolution_due: string }[] };
      ticket_set_status: { Args: { p_ticket: string; p_status: TicketStatus; p_note?: string | null }; Returns: undefined };
      ticket_forward: { Args: { p_ticket: string; p_department: Department; p_assignee: string | null; p_reason: string }; Returns: undefined };
      ticket_assign: { Args: { p_ticket: string; p_assignee: string | null }; Returns: undefined };
      sla_sweep: { Args: never; Returns: number };
      doc_today: { Args: never; Returns: string };
      doc_generate: { Args: { p_requirement?: string | null; p_today?: string | null }; Returns: number };
      documents_sweep: { Args: { p_now?: string | null }; Returns: Json };
      channel_ingest: {
        Args: {
          p_account: string; p_direction: MessageDirection; p_external_id: string | null; p_contact_address: string;
          p_contact_name: string | null; p_kind: string; p_subject: string | null; p_body: string | null; p_media: Json | null;
          p_status: MessageStatus; p_via: string | null; p_sent_at: string; p_sent_by?: string | null;
        };
        Returns: string | null;
      };
      channel_claim_sync: { Args: { p_account: string; p_min_interval_seconds: number }; Returns: boolean };
      channel_message_status: { Args: { p_account: string; p_external_id: string; p_status: MessageStatus; p_error?: string | null }; Returns: boolean };
    };
    Enums: {
      user_role: UserRole;
      department: Department;
      client_status: ClientStatus;
      tax_regime: TaxRegime;
      ticket_status: TicketStatus;
      ticket_priority: TicketPriority;
      ticket_origin: TicketOrigin;
      sla_unit: SlaUnit;
      ticket_event_kind: TicketEventKind;
      doc_periodicity: DocPeriodicity;
      doc_status: DocStatus;
      reminder_channel: ReminderChannel;
      reminder_status: ReminderStatus;
      channel_kind: ChannelKind;
      channel_status: ChannelStatus;
      message_direction: MessageDirection;
      message_status: MessageStatus;
    };
    CompositeTypes: { [_ in never]: never };
  };
};
