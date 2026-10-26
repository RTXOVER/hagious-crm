// Tipos do banco. Escrito conforme supabase/migrations; regenere com:
//   npx supabase gen types typescript --local > src/lib/database.types.ts
// (ou --project-id <id> quando usar o projeto na nuvem)

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type UserRole = "admin" | "gestor" | "colaborador";
type Department = "contabil" | "fiscal" | "dp" | "atendimento";
type ClientStatus = "ativo" | "suspenso" | "encerrado";
type TaxRegime = "mei" | "simples_nacional" | "lucro_presumido" | "lucro_real" | "outro";

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
    };
    Views: { [_ in never]: never };
    Functions: {
      can_view_client: { Args: { p_client_id: string }; Returns: boolean };
      is_admin: { Args: never; Returns: boolean };
      is_manager: { Args: never; Returns: boolean };
      is_valid_cnpj: { Args: { cnpj: string }; Returns: boolean };
    };
    Enums: {
      user_role: UserRole;
      department: Department;
      client_status: ClientStatus;
      tax_regime: TaxRegime;
    };
    CompositeTypes: { [_ in never]: never };
  };
};
