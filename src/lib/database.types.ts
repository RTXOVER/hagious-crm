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
  id: number; user_id: string; ticket_id: string | null; kind: string; title: string; body: string | null;
  link: string | null; dedupe_key: string; read_at: string | null; created_at: string;
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
        [{ foreignKeyName: "notifications_ticket_id_fkey"; columns: ["ticket_id"]; isOneToOne: false; referencedRelation: "tickets"; referencedColumns: ["id"] }]
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
    };
    CompositeTypes: { [_ in never]: never };
  };
};
