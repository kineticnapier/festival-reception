import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const dayState = sqliteTable("day_state", {
  dayKey: text("day_key").primaryKey(),
  currentCount: integer("current_count").notNull().default(0),
  totalCount: integer("total_count").notNull().default(0),
  maxCurrent: integer("max_current").notNull().default(0),
  nextTicket: integer("next_ticket").notNull().default(1),
  calledTicketNumber: integer("called_ticket_number"),
  capacity: integer("capacity").notNull().default(6),
  priorStayMinutes: integer("prior_stay_minutes").notNull().default(8),
  normalCapacity: integer("normal_capacity").notNull().default(13),
  overflowCapacity: integer("overflow_capacity").notNull().default(16),
  overflowEnabled: integer("overflow_enabled", { mode: "boolean" }).notNull().default(false),
  priorStaySeconds: integer("prior_stay_seconds").notNull().default(150),
  reserveWaitSeconds: integer("reserve_wait_seconds").notNull().default(300),
  revision: integer("revision").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

export const tickets = sqliteTable("tickets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dayKey: text("day_key").notNull(),
  number: integer("number").notNull(),
  partySize: integer("party_size").notNull().default(1),
  status: text("status").notNull().default("waiting"),
  createdAt: integer("created_at").notNull(),
  calledAt: integer("called_at"),
  admittedAt: integer("admitted_at"),
  cancelledAt: integer("cancelled_at"),
}, (table) => [
  uniqueIndex("tickets_day_number_unique").on(table.dayKey, table.number),
  index("tickets_day_status_number_idx").on(table.dayKey, table.status, table.number),
]);

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dayKey: text("day_key").notNull(),
  opId: text("op_id").notNull(),
  type: text("type").notNull(),
  ticketNumber: integer("ticket_number"),
  groupId: integer("group_id"),
  details: text("details"),
  partySize: integer("party_size").notNull().default(1),
  undone: integer("undone", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("events_day_created_idx").on(table.dayKey, table.createdAt),
  index("events_day_op_idx").on(table.dayKey, table.opId),
  index("events_day_undone_id_idx").on(table.dayKey, table.undone, table.id),
]);

export const visitorGroups = sqliteTable("visitor_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dayKey: text("day_key").notNull(),
  ticketNumber: integer("ticket_number"),
  status: text("status").notNull().default("waiting"),
  partySize: integer("party_size").notNull(),
  studentCount: integer("student_count"),
  externalCount: integer("external_count"),
  grade1Count: integer("grade1_count"),
  grade2Count: integer("grade2_count"),
  grade3Count: integer("grade3_count"),
  middleGrade1Count: integer("middle_grade1_count"),
  middleGrade2Count: integer("middle_grade2_count"),
  middleGrade3Count: integer("middle_grade3_count"),
  highGrade1Count: integer("high_grade1_count"),
  highGrade2Count: integer("high_grade2_count"),
  highGrade3Count: integer("high_grade3_count"),
  maleCount: integer("male_count"),
  femaleCount: integer("female_count"),
  adultCount: integer("adult_count"),
  childCount: integer("child_count"),
  createdAt: integer("created_at").notNull(),
  calledAt: integer("called_at"),
  admittedAt: integer("admitted_at"),
  exitedAt: integer("exited_at"),
  cancelledAt: integer("cancelled_at"),
}, (table) => [
  uniqueIndex("visitor_groups_day_ticket_unique").on(table.dayKey, table.ticketNumber),
  index("visitor_groups_day_status_ticket_idx").on(table.dayKey, table.status, table.ticketNumber),
  index("visitor_groups_day_status_admitted_idx").on(table.dayKey, table.status, table.admittedAt),
  index("visitor_groups_day_status_exited_idx").on(table.dayKey, table.status, table.exitedAt),
]);

export const authSessions = sqliteTable("auth_sessions", {
  id: text("id").primaryKey(),
  role: text("role").notNull(),
  deviceLabel: text("device_label").notNull(),
  userAgent: text("user_agent"),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  revokedAt: integer("revoked_at"),
}, (table) => [
  index("auth_sessions_role_active_idx").on(table.role, table.revokedAt, table.expiresAt),
]);

export const socialLinks = sqliteTable("social_links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  url: text("url").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("social_links_enabled_sort_idx").on(table.enabled, table.sortOrder),
]);

export const operationRequests = sqliteTable("operation_requests", {
  requestId: text("request_id").primaryKey(),
  dayKey: text("day_key").notNull(),
  action: text("action").notNull(),
  state: text("state").notNull().default("started"),
  responseJson: text("response_json"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
}, (table) => [
  index("operation_requests_day_created_idx").on(table.dayKey, table.createdAt),
]);

export const mutationLocks = sqliteTable("mutation_locks", {
  dayKey: text("day_key").primaryKey(),
  ownerRequestId: text("owner_request_id").notNull(),
  acquiredAt: integer("acquired_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [
  index("mutation_locks_expires_idx").on(table.expiresAt),
]);

export const authRateLimits = sqliteTable("auth_rate_limits", {
  scopeKey: text("scope_key").primaryKey(),
  failureCount: integer("failure_count").notNull().default(0),
  windowStartedAt: integer("window_started_at").notNull(),
  blockedUntil: integer("blocked_until").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("auth_rate_limits_updated_idx").on(table.updatedAt),
]);
