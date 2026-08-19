export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      _meter_migration_backup_customers: {
        Row: {
          id: string | null
          meter_number: string | null
          tenant_id: string | null
        }
        Insert: {
          id?: string | null
          meter_number?: string | null
          tenant_id?: string | null
        }
        Update: {
          id?: string | null
          meter_number?: string | null
          tenant_id?: string | null
        }
        Relationships: []
      }
      _meter_migration_backup_readings: {
        Row: {
          consumption: number | null
          customer_id: string | null
          id: string | null
          meter_number: string | null
          previous: number | null
          tenant_id: string | null
        }
        Insert: {
          consumption?: number | null
          customer_id?: string | null
          id?: string | null
          meter_number?: string | null
          previous?: number | null
          tenant_id?: string | null
        }
        Update: {
          consumption?: number | null
          customer_id?: string | null
          id?: string | null
          meter_number?: string | null
          previous?: number | null
          tenant_id?: string | null
        }
        Relationships: []
      }
      accounting_periods: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          end_date: string
          id: string
          is_closed: boolean
          period_name: string
          start_date: string
          tenant_id: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          end_date: string
          id?: string
          is_closed?: boolean
          period_name: string
          start_date: string
          tenant_id: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          end_date?: string
          id?: string
          is_closed?: boolean
          period_name?: string
          start_date?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_periods_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity: string | null
          entity_id: string | null
          id: string
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity?: string | null
          entity_id?: string | null
          id?: string
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity?: string | null
          entity_id?: string | null
          id?: string
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_adjustments: {
        Row: {
          amount: number
          approved_by: string | null
          bill_id: string | null
          created_at: string | null
          created_by: string | null
          customer_id: string
          id: string
          reading_id: string | null
          reason: string
          status: string
          tenant_id: string
          type: string
        }
        Insert: {
          amount: number
          approved_by?: string | null
          bill_id?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_id: string
          id?: string
          reading_id?: string | null
          reason: string
          status?: string
          tenant_id: string
          type: string
        }
        Update: {
          amount?: number
          approved_by?: string | null
          bill_id?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_id?: string
          id?: string
          reading_id?: string | null
          reason?: string
          status?: string
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_adjustments_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "water_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_adjustments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_adjustments_reading_id_fkey"
            columns: ["reading_id"]
            isOneToOne: false
            referencedRelation: "water_readings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_adjustments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_balances: {
        Row: {
          current_balance: number
          customer_id: string
          last_ledger_id: string | null
          tenant_id: string
          total_credits: number
          total_debits: number
          updated_at: string
        }
        Insert: {
          current_balance?: number
          customer_id: string
          last_ledger_id?: string | null
          tenant_id: string
          total_credits?: number
          total_debits?: number
          updated_at?: string
        }
        Update: {
          current_balance?: number
          customer_id?: string
          last_ledger_id?: string | null
          tenant_id?: string
          total_credits?: number
          total_debits?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_balances_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_balances_last_ledger_id_fkey"
            columns: ["last_ledger_id"]
            isOneToOne: false
            referencedRelation: "customer_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_balances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_ledger: {
        Row: {
          credit_amount: number
          customer_id: string
          debit_amount: number
          description: string | null
          entry_type: string
          id: string
          posted_at: string
          reference_id: string
          running_balance: number
          tenant_id: string
        }
        Insert: {
          credit_amount?: number
          customer_id: string
          debit_amount?: number
          description?: string | null
          entry_type: string
          id?: string
          posted_at?: string
          reference_id: string
          running_balance?: number
          tenant_id: string
        }
        Update: {
          credit_amount?: number
          customer_id?: string
          debit_amount?: number
          description?: string | null
          entry_type?: string
          id?: string
          posted_at?: string
          reference_id?: string
          running_balance?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_ledger_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_ledger_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          balance: number
          created_at: string
          directorate: string | null
          family_members: number
          geo_accuracy: number | null
          geo_captured_at: string | null
          id: string
          latitude: number | null
          longitude: number | null
          name: string
          pay_account: string | null
          phone: string | null
          security_deposit: number
          status: string
          submitted_at: string | null
          submitted_by: string | null
          suspended_reason: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          balance?: number
          created_at?: string
          directorate?: string | null
          family_members?: number
          geo_accuracy?: number | null
          geo_captured_at?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name: string
          pay_account?: string | null
          phone?: string | null
          security_deposit?: number
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          suspended_reason?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          balance?: number
          created_at?: string
          directorate?: string | null
          family_members?: number
          geo_accuracy?: number | null
          geo_captured_at?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          pay_account?: string | null
          phone?: string | null
          security_deposit?: number
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          suspended_reason?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      device_sessions: {
        Row: {
          created_at: string
          device_fingerprint: string
          device_label: string | null
          id: string
          last_seen_at: string
          tenant_id: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          device_fingerprint: string
          device_label?: string | null
          id?: string
          last_seen_at?: string
          tenant_id?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          device_fingerprint?: string
          device_label?: string | null
          id?: string
          last_seen_at?: string
          tenant_id?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      meter_assignments: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          end_reason: string | null
          ended_at: string | null
          id: string
          meter_id: string
          note: string | null
          started_at: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          meter_id: string
          note?: string | null
          started_at?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          meter_id?: string
          note?: string | null
          started_at?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meter_assignments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meter_assignments_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meter_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      meters: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          initial_index: number
          installed_at: string | null
          meter_type: string
          notes: string | null
          serial: string
          size: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          initial_index?: number
          installed_at?: string | null
          meter_type?: string
          notes?: string | null
          serial: string
          size?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          initial_index?: number
          installed_at?: string | null
          meter_type?: string
          notes?: string | null
          serial?: string
          size?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meters_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          bill_id: string | null
          client_uuid: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          id: string
          method: string
          paid_at: string
          reject_reason: string | null
          rejected_at: string | null
          rejected_by: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          bill_id?: string | null
          client_uuid?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          method?: string
          paid_at?: string
          reject_reason?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          bill_id?: string | null
          client_uuid?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          id?: string
          method?: string
          paid_at?: string
          reject_reason?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "water_bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      production_log: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          logged_at: string
          notes: string | null
          produced_m3: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          logged_at?: string
          notes?: string | null
          produced_m3?: number
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          logged_at?: string
          notes?: string | null
          produced_m3?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          must_change_password: boolean
          phone: string | null
          tenant_id: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          must_change_password?: boolean
          phone?: string | null
          tenant_id?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          must_change_password?: boolean
          phone?: string | null
          tenant_id?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tariff_tiers: {
        Row: {
          id: string
          rate_per_m3: number
          tariff_id: string
          tenant_id: string
          tier_order: number
          upper_bound: number | null
        }
        Insert: {
          id?: string
          rate_per_m3: number
          tariff_id: string
          tenant_id: string
          tier_order: number
          upper_bound?: number | null
        }
        Update: {
          id?: string
          rate_per_m3?: number
          tariff_id?: string
          tenant_id?: string
          tier_order?: number
          upper_bound?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tariff_tiers_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariffs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tariff_tiers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tariff_versions: {
        Row: {
          created_at: string | null
          effective_from: string
          effective_to: string | null
          id: string
          rate_structure: Json
          tariff_id: string
          tenant_id: string
          valid_period: unknown
        }
        Insert: {
          created_at?: string | null
          effective_from: string
          effective_to?: string | null
          id?: string
          rate_structure: Json
          tariff_id: string
          tenant_id: string
          valid_period?: unknown
        }
        Update: {
          created_at?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          rate_structure?: Json
          tariff_id?: string
          tenant_id?: string
          valid_period?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "tariff_versions_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariffs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tariff_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tariffs: {
        Row: {
          created_at: string
          currency: string
          fixed_fee: number
          id: string
          is_active: boolean
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          fixed_fee?: number
          id?: string
          is_active?: boolean
          name?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          fixed_fee?: number
          id?: string
          is_active?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tariffs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenancy_logs: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: string
          ended_at: string | null
          id: string
          meter_number: string
          note: string | null
          started_at: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: string
          ended_at?: string | null
          id?: string
          meter_number: string
          note?: string | null
          started_at?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: string
          ended_at?: string | null
          id?: string
          meter_number?: string
          note?: string | null
          started_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenancy_logs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenancy_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          arrears_threshold: number
          auto_suspend: boolean
          created_at: string
          id: string
          max_devices: number
          name: string
          subscription_expires_at: string | null
          subscription_status: Database["public"]["Enums"]["subscription_status"]
          updated_at: string
        }
        Insert: {
          arrears_threshold?: number
          auto_suspend?: boolean
          created_at?: string
          id?: string
          max_devices?: number
          name: string
          subscription_expires_at?: string | null
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          updated_at?: string
        }
        Update: {
          arrears_threshold?: number
          auto_suspend?: boolean
          created_at?: string
          id?: string
          max_devices?: number
          name?: string
          subscription_expires_at?: string | null
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      water_bills: {
        Row: {
          amount: number
          arrears: number
          arrears_snapshot: number | null
          bill_number: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          due_date: string | null
          id: string
          issued_at: string
          net_amount: number | null
          paid_amount: number
          paid_at: string | null
          reading_id: string | null
          status: string
          subtotal: number
          tariff_version_id: string | null
          tenant_id: string
          total: number
          updated_at: string
        }
        Insert: {
          amount?: number
          arrears?: number
          arrears_snapshot?: number | null
          bill_number?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          due_date?: string | null
          id?: string
          issued_at?: string
          net_amount?: number | null
          paid_amount?: number
          paid_at?: string | null
          reading_id?: string | null
          status?: string
          subtotal?: number
          tariff_version_id?: string | null
          tenant_id: string
          total?: number
          updated_at?: string
        }
        Update: {
          amount?: number
          arrears?: number
          arrears_snapshot?: number | null
          bill_number?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          due_date?: string | null
          id?: string
          issued_at?: string
          net_amount?: number | null
          paid_amount?: number
          paid_at?: string | null
          reading_id?: string | null
          status?: string
          subtotal?: number
          tariff_version_id?: string | null
          tenant_id?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "water_bills_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "water_bills_reading_id_fkey"
            columns: ["reading_id"]
            isOneToOne: true
            referencedRelation: "water_readings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "water_bills_tariff_version_id_fkey"
            columns: ["tariff_version_id"]
            isOneToOne: false
            referencedRelation: "tariff_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "water_bills_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      water_readings: {
        Row: {
          accuracy: number | null
          approved_at: string | null
          approved_by: string | null
          client_uuid: string | null
          consumption: number | null
          created_at: string
          created_by: string | null
          current_reading: number
          customer_id: string
          flag: string | null
          gps_verified: boolean
          id: string
          is_chained: boolean | null
          lat: number | null
          lng: number | null
          meter_id: string
          ocr_serial: string | null
          photo_url: string | null
          previous: number | null
          reader_id: string | null
          reading_date: string
          reject_reason: string | null
          rejected_at: string | null
          rejected_by: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          accuracy?: number | null
          approved_at?: string | null
          approved_by?: string | null
          client_uuid?: string | null
          consumption?: number | null
          created_at?: string
          created_by?: string | null
          current_reading: number
          customer_id: string
          flag?: string | null
          gps_verified?: boolean
          id?: string
          is_chained?: boolean | null
          lat?: number | null
          lng?: number | null
          meter_id: string
          ocr_serial?: string | null
          photo_url?: string | null
          previous?: number | null
          reader_id?: string | null
          reading_date?: string
          reject_reason?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          accuracy?: number | null
          approved_at?: string | null
          approved_by?: string | null
          client_uuid?: string | null
          consumption?: number | null
          created_at?: string
          created_by?: string | null
          current_reading?: number
          customer_id?: string
          flag?: string | null
          gps_verified?: boolean
          id?: string
          is_chained?: boolean | null
          lat?: number | null
          lng?: number | null
          meter_id?: string
          ocr_serial?: string | null
          photo_url?: string | null
          previous?: number | null
          reader_id?: string | null
          reading_date?: string
          reject_reason?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "water_readings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "water_readings_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "water_readings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acquire_customer_lock: {
        Args: { _customer_id: string; _tenant_id: string }
        Returns: undefined
      }
      approve_payment: { Args: { _payment_id: string }; Returns: undefined }
      approve_reading: { Args: { _reading_id: string }; Returns: undefined }
      assert_authenticated_context: { Args: never; Returns: undefined }
      assert_tenant_role: {
        Args: { _roles: string[]; _tenant_id: string }
        Returns: boolean
      }
      assign_meter: {
        Args: {
          _customer_id: string
          _initial_index?: number
          _installed_at?: string
          _meter_type?: string
          _serial: string
          _started_at?: string
        }
        Returns: string
      }
      current_tenant_id: { Args: never; Returns: string }
      email_for_username: { Args: { _username: string }; Returns: string }
      execute_ledger_backfill: {
        Args: never
        Returns: {
          processed_records: number
          skipped_records: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_tenant_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _tenant_id: string
        }
        Returns: boolean
      }
      is_period_closed: {
        Args: { _date: string; _tenant_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: never; Returns: boolean }
      issue_bill_for_reading: {
        Args: {
          _reading: Database["public"]["Tables"]["water_readings"]["Row"]
        }
        Returns: string
      }
      post_ledger_entry: {
        Args: {
          _credit: number
          _customer_id: string
          _debit: number
          _description: string
          _entry_type: string
          _reference_id: string
          _tenant_id: string
        }
        Returns: undefined
      }
      price_consumption: {
        Args: { _consumption: number; _tenant_id: string }
        Returns: number
      }
      recalc_customer_balance: {
        Args: { _customer_id: string }
        Returns: number
      }
      record_payment: {
        Args: {
          _amount: number
          _bill_id: string
          _client_uuid?: string
          _method: string
        }
        Returns: string
      }
      register_device_slot: {
        Args: {
          _device_fingerprint: string
          _device_label?: string
          _user_agent?: string
        }
        Returns: undefined
      }
      reject_payment: {
        Args: { _payment_id: string; _reason?: string }
        Returns: undefined
      }
      reject_reading: {
        Args: { _reading_id: string; _reason?: string }
        Returns: undefined
      }
      replace_meter: {
        Args: {
          _customer_id: string
          _new_initial_index?: number
          _new_serial: string
          _old_meter_status?: string
          _reason?: string
          _started_at?: string
        }
        Returns: string
      }
      storage_path_in_tenant: {
        Args: { storage_path: string }
        Returns: boolean
      }
      unassign_meter: {
        Args: { _customer_id: string; _reason?: string }
        Returns: undefined
      }
      user_belongs_to_org_path: {
        Args: { storage_path: string }
        Returns: boolean
      }
      verify_financial_integrity: {
        Args: never
        Returns: {
          check_name: string
          details: string
          status: string
        }[]
      }
    }
    Enums: {
      app_role: "super_admin" | "manager" | "reader" | "collector"
      subscription_status: "active" | "suspended" | "expired"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["super_admin", "manager", "reader", "collector"],
      subscription_status: ["active", "suspended", "expired"],
    },
  },
} as const
