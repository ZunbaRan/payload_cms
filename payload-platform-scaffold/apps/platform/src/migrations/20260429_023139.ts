import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`users_sessions\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`created_at\` text,
  	\`expires_at\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`users_sessions_order_idx\` ON \`users_sessions\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`users_sessions_parent_id_idx\` ON \`users_sessions\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`users\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`email\` text NOT NULL,
  	\`reset_password_token\` text,
  	\`reset_password_expiration\` text,
  	\`salt\` text,
  	\`hash\` text,
  	\`login_attempts\` numeric DEFAULT 0,
  	\`lock_until\` text
  );
  `)
  await db.run(sql`CREATE INDEX \`users_updated_at_idx\` ON \`users\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`users_created_at_idx\` ON \`users\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`users_email_idx\` ON \`users\` (\`email\`);`)
  await db.run(sql`CREATE TABLE \`authors\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text NOT NULL,
  	\`slug\` text,
  	\`email\` text,
  	\`avatar_id\` integer,
  	\`bio\` text,
  	\`is_active\` integer DEFAULT true,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`avatar_id\`) REFERENCES \`images\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`authors_slug_idx\` ON \`authors\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`authors_avatar_idx\` ON \`authors\` (\`avatar_id\`);`)
  await db.run(sql`CREATE INDEX \`authors_updated_at_idx\` ON \`authors\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`authors_created_at_idx\` ON \`authors\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`tags\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text NOT NULL,
  	\`slug\` text,
  	\`usage_count\` numeric DEFAULT 0,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`tags_slug_idx\` ON \`tags\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`tags_updated_at_idx\` ON \`tags\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`tags_created_at_idx\` ON \`tags\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`title_libraries\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text NOT NULL,
  	\`description\` text,
  	\`title_count\` numeric DEFAULT 0,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`title_libraries_updated_at_idx\` ON \`title_libraries\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`title_libraries_created_at_idx\` ON \`title_libraries\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`titles\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`text\` text NOT NULL,
  	\`library_id\` integer NOT NULL,
  	\`status\` text DEFAULT 'pending',
  	\`is_ai_generated\` integer DEFAULT false,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`library_id\`) REFERENCES \`title_libraries\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`titles_library_idx\` ON \`titles\` (\`library_id\`);`)
  await db.run(sql`CREATE INDEX \`titles_updated_at_idx\` ON \`titles\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`titles_created_at_idx\` ON \`titles\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`titles_texts\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer NOT NULL,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`text\` text,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`titles\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`titles_texts_order_parent\` ON \`titles_texts\` (\`order\`,\`parent_id\`);`)
  await db.run(sql`CREATE TABLE \`keyword_libraries\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text NOT NULL,
  	\`description\` text,
  	\`keyword_count\` numeric DEFAULT 0,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`keyword_libraries_updated_at_idx\` ON \`keyword_libraries\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`keyword_libraries_created_at_idx\` ON \`keyword_libraries\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`keywords\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`text\` text NOT NULL,
  	\`library_id\` integer NOT NULL,
  	\`weight\` numeric DEFAULT 1,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`library_id\`) REFERENCES \`keyword_libraries\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`keywords_library_idx\` ON \`keywords\` (\`library_id\`);`)
  await db.run(sql`CREATE INDEX \`keywords_updated_at_idx\` ON \`keywords\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`keywords_created_at_idx\` ON \`keywords\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`keywords_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`tags_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`keywords\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`tags_id\`) REFERENCES \`tags\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`keywords_rels_order_idx\` ON \`keywords_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`keywords_rels_parent_idx\` ON \`keywords_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`keywords_rels_path_idx\` ON \`keywords_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`keywords_rels_tags_id_idx\` ON \`keywords_rels\` (\`tags_id\`);`)
  await db.run(sql`CREATE TABLE \`image_libraries\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text NOT NULL,
  	\`description\` text,
  	\`image_count\` numeric DEFAULT 0,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`image_libraries_updated_at_idx\` ON \`image_libraries\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`image_libraries_created_at_idx\` ON \`image_libraries\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`images\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`alt\` text,
  	\`library_id\` integer,
  	\`caption\` text,
  	\`usage_count\` numeric DEFAULT 0,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`url\` text,
  	\`thumbnail_u_r_l\` text,
  	\`filename\` text,
  	\`mime_type\` text,
  	\`filesize\` numeric,
  	\`width\` numeric,
  	\`height\` numeric,
  	\`focal_x\` numeric,
  	\`focal_y\` numeric,
  	FOREIGN KEY (\`library_id\`) REFERENCES \`image_libraries\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`images_library_idx\` ON \`images\` (\`library_id\`);`)
  await db.run(sql`CREATE INDEX \`images_updated_at_idx\` ON \`images\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`images_created_at_idx\` ON \`images\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`images_filename_idx\` ON \`images\` (\`filename\`);`)
  await db.run(sql`CREATE TABLE \`images_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`tags_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`images\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`tags_id\`) REFERENCES \`tags\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`images_rels_order_idx\` ON \`images_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`images_rels_parent_idx\` ON \`images_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`images_rels_path_idx\` ON \`images_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`images_rels_tags_id_idx\` ON \`images_rels\` (\`tags_id\`);`)
  await db.run(sql`CREATE TABLE \`knowledge_bases\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text NOT NULL,
  	\`description\` text,
  	\`source_type\` text DEFAULT 'manual',
  	\`uploaded_file_id\` integer,
  	\`source_url\` text,
  	\`fetch_agent_task_id\` integer,
  	\`raw_content\` text,
  	\`chunk_size\` numeric DEFAULT 800,
  	\`chunk_overlap\` numeric DEFAULT 100,
  	\`embedding_model_id\` integer,
  	\`sync_status\` text DEFAULT 'pending',
  	\`chunk_count\` numeric DEFAULT 0,
  	\`last_synced_at\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`uploaded_file_id\`) REFERENCES \`kb_uploads\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`fetch_agent_task_id\`) REFERENCES \`agent_tasks\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`embedding_model_id\`) REFERENCES \`ai_models\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`knowledge_bases_uploaded_file_idx\` ON \`knowledge_bases\` (\`uploaded_file_id\`);`)
  await db.run(sql`CREATE INDEX \`knowledge_bases_fetch_agent_task_idx\` ON \`knowledge_bases\` (\`fetch_agent_task_id\`);`)
  await db.run(sql`CREATE INDEX \`knowledge_bases_embedding_model_idx\` ON \`knowledge_bases\` (\`embedding_model_id\`);`)
  await db.run(sql`CREATE INDEX \`knowledge_bases_updated_at_idx\` ON \`knowledge_bases\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`knowledge_bases_created_at_idx\` ON \`knowledge_bases\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`knowledge_chunks\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`knowledge_base_id\` integer NOT NULL,
  	\`chunk_index\` numeric NOT NULL,
  	\`content\` text NOT NULL,
  	\`preview\` text,
  	\`token_count\` numeric,
  	\`embedding\` text,
  	\`metadata\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`knowledge_base_id\`) REFERENCES \`knowledge_bases\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`knowledge_chunks_knowledge_base_idx\` ON \`knowledge_chunks\` (\`knowledge_base_id\`);`)
  await db.run(sql`CREATE INDEX \`knowledge_chunks_updated_at_idx\` ON \`knowledge_chunks\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`knowledge_chunks_created_at_idx\` ON \`knowledge_chunks\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`kb_uploads\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`note\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`url\` text,
  	\`thumbnail_u_r_l\` text,
  	\`filename\` text,
  	\`mime_type\` text,
  	\`filesize\` numeric,
  	\`width\` numeric,
  	\`height\` numeric,
  	\`focal_x\` numeric,
  	\`focal_y\` numeric
  );
  `)
  await db.run(sql`CREATE INDEX \`kb_uploads_updated_at_idx\` ON \`kb_uploads\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`kb_uploads_created_at_idx\` ON \`kb_uploads\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`kb_uploads_filename_idx\` ON \`kb_uploads\` (\`filename\`);`)
  await db.run(sql`CREATE TABLE \`kb_index_runs\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`knowledge_base_id\` integer NOT NULL,
  	\`kind\` text DEFAULT 'index',
  	\`status\` text DEFAULT 'queued',
  	\`phase\` text DEFAULT 'pending',
  	\`progress\` numeric DEFAULT 0,
  	\`total_chunks\` numeric DEFAULT 0,
  	\`embedded_chunks\` numeric DEFAULT 0,
  	\`started_at\` text,
  	\`finished_at\` text,
  	\`duration_ms\` numeric,
  	\`message\` text,
  	\`logs\` text,
  	\`agent_task_run_id\` integer,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`knowledge_base_id\`) REFERENCES \`knowledge_bases\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`agent_task_run_id\`) REFERENCES \`agent_task_runs\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`kb_index_runs_knowledge_base_idx\` ON \`kb_index_runs\` (\`knowledge_base_id\`);`)
  await db.run(sql`CREATE INDEX \`kb_index_runs_status_idx\` ON \`kb_index_runs\` (\`status\`);`)
  await db.run(sql`CREATE INDEX \`kb_index_runs_agent_task_run_idx\` ON \`kb_index_runs\` (\`agent_task_run_id\`);`)
  await db.run(sql`CREATE INDEX \`kb_index_runs_updated_at_idx\` ON \`kb_index_runs\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`kb_index_runs_created_at_idx\` ON \`kb_index_runs\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`ai_models\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text NOT NULL,
  	\`model_type\` text DEFAULT 'text' NOT NULL,
  	\`provider\` text DEFAULT 'openai' NOT NULL,
  	\`model_id\` text NOT NULL,
  	\`base_url\` text,
  	\`api_key\` text,
  	\`temperature\` numeric DEFAULT 0.7,
  	\`max_tokens\` numeric DEFAULT 4096,
  	\`embedding_dimensions\` numeric,
  	\`daily_request_limit\` numeric,
  	\`daily_token_limit\` numeric,
  	\`priority\` numeric DEFAULT 100,
  	\`is_active\` integer DEFAULT true,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`ai_models_updated_at_idx\` ON \`ai_models\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`ai_models_created_at_idx\` ON \`ai_models\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`prompts_variables\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`key\` text NOT NULL,
  	\`description\` text,
  	\`default_value\` text,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`prompts\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`prompts_variables_order_idx\` ON \`prompts_variables\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`prompts_variables_parent_id_idx\` ON \`prompts_variables\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`prompts\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text NOT NULL,
  	\`slug\` text,
  	\`category\` text DEFAULT 'content',
  	\`system_prompt\` text,
  	\`user_template\` text NOT NULL,
  	\`preferred_model_id\` integer,
  	\`version\` numeric DEFAULT 1,
  	\`is_active\` integer DEFAULT true,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`preferred_model_id\`) REFERENCES \`ai_models\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`prompts_slug_idx\` ON \`prompts\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`prompts_preferred_model_idx\` ON \`prompts\` (\`preferred_model_id\`);`)
  await db.run(sql`CREATE INDEX \`prompts_updated_at_idx\` ON \`prompts\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`prompts_created_at_idx\` ON \`prompts\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`categories\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text NOT NULL,
  	\`slug\` text NOT NULL,
  	\`description\` text,
  	\`parent_id\` integer,
  	\`sort_order\` numeric DEFAULT 0,
  	\`is_active\` integer DEFAULT true,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`categories\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`categories_slug_idx\` ON \`categories\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`categories_parent_idx\` ON \`categories\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`categories_updated_at_idx\` ON \`categories\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`categories_created_at_idx\` ON \`categories\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`articles\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`title\` text,
  	\`slug\` text,
  	\`excerpt\` text,
  	\`content\` text,
  	\`status\` text DEFAULT 'draft',
  	\`review_status\` text DEFAULT 'unreviewed',
  	\`author_id\` integer,
  	\`category_id\` integer,
  	\`cover_image_id\` integer,
  	\`seo_meta_title\` text,
  	\`seo_meta_description\` text,
  	\`seo_meta_keywords\` text,
  	\`seo_og_image_id\` integer,
  	\`is_ai_generated\` integer DEFAULT false,
  	\`is_featured\` integer DEFAULT false,
  	\`is_hot\` integer DEFAULT false,
  	\`source_task_id\` integer,
  	\`source_title_id\` integer,
  	\`view_count\` numeric DEFAULT 0,
  	\`published_at\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`_status\` text DEFAULT 'draft',
  	FOREIGN KEY (\`author_id\`) REFERENCES \`authors\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`category_id\`) REFERENCES \`categories\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`cover_image_id\`) REFERENCES \`images\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`seo_og_image_id\`) REFERENCES \`images\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`source_task_id\`) REFERENCES \`tasks\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`source_title_id\`) REFERENCES \`titles\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`articles_slug_idx\` ON \`articles\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`articles_author_idx\` ON \`articles\` (\`author_id\`);`)
  await db.run(sql`CREATE INDEX \`articles_category_idx\` ON \`articles\` (\`category_id\`);`)
  await db.run(sql`CREATE INDEX \`articles_cover_image_idx\` ON \`articles\` (\`cover_image_id\`);`)
  await db.run(sql`CREATE INDEX \`articles_seo_seo_og_image_idx\` ON \`articles\` (\`seo_og_image_id\`);`)
  await db.run(sql`CREATE INDEX \`articles_source_task_idx\` ON \`articles\` (\`source_task_id\`);`)
  await db.run(sql`CREATE INDEX \`articles_source_title_idx\` ON \`articles\` (\`source_title_id\`);`)
  await db.run(sql`CREATE INDEX \`articles_updated_at_idx\` ON \`articles\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`articles_created_at_idx\` ON \`articles\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`articles__status_idx\` ON \`articles\` (\`_status\`);`)
  await db.run(sql`CREATE TABLE \`articles_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`keywords_id\` integer,
  	\`images_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`articles\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`keywords_id\`) REFERENCES \`keywords\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`images_id\`) REFERENCES \`images\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`articles_rels_order_idx\` ON \`articles_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`articles_rels_parent_idx\` ON \`articles_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`articles_rels_path_idx\` ON \`articles_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`articles_rels_keywords_id_idx\` ON \`articles_rels\` (\`keywords_id\`);`)
  await db.run(sql`CREATE INDEX \`articles_rels_images_id_idx\` ON \`articles_rels\` (\`images_id\`);`)
  await db.run(sql`CREATE TABLE \`_articles_v\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`parent_id\` integer,
  	\`version_title\` text,
  	\`version_slug\` text,
  	\`version_excerpt\` text,
  	\`version_content\` text,
  	\`version_status\` text DEFAULT 'draft',
  	\`version_review_status\` text DEFAULT 'unreviewed',
  	\`version_author_id\` integer,
  	\`version_category_id\` integer,
  	\`version_cover_image_id\` integer,
  	\`version_seo_meta_title\` text,
  	\`version_seo_meta_description\` text,
  	\`version_seo_meta_keywords\` text,
  	\`version_seo_og_image_id\` integer,
  	\`version_is_ai_generated\` integer DEFAULT false,
  	\`version_is_featured\` integer DEFAULT false,
  	\`version_is_hot\` integer DEFAULT false,
  	\`version_source_task_id\` integer,
  	\`version_source_title_id\` integer,
  	\`version_view_count\` numeric DEFAULT 0,
  	\`version_published_at\` text,
  	\`version_updated_at\` text,
  	\`version_created_at\` text,
  	\`version__status\` text DEFAULT 'draft',
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`latest\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`articles\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`version_author_id\`) REFERENCES \`authors\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`version_category_id\`) REFERENCES \`categories\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`version_cover_image_id\`) REFERENCES \`images\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`version_seo_og_image_id\`) REFERENCES \`images\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`version_source_task_id\`) REFERENCES \`tasks\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`version_source_title_id\`) REFERENCES \`titles\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`_articles_v_parent_idx\` ON \`_articles_v\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_articles_v_version_version_slug_idx\` ON \`_articles_v\` (\`version_slug\`);`)
  await db.run(sql`CREATE INDEX \`_articles_v_version_version_author_idx\` ON \`_articles_v\` (\`version_author_id\`);`)
  await db.run(sql`CREATE INDEX \`_articles_v_version_version_category_idx\` ON \`_articles_v\` (\`version_category_id\`);`)
  await db.run(sql`CREATE INDEX \`_articles_v_version_version_cover_image_idx\` ON \`_articles_v\` (\`version_cover_image_id\`);`)
  await db.run(sql`CREATE INDEX \`_articles_v_version_seo_version_seo_og_image_idx\` ON \`_articles_v\` (\`version_seo_og_image_id\`);`)
  await db.run(sql`CREATE INDEX \`_articles_v_version_version_source_task_idx\` ON \`_articles_v\` (\`version_source_task_id\`);`)
  await db.run(sql`CREATE INDEX \`_articles_v_version_version_source_title_idx\` ON \`_articles_v\` (\`version_source_title_id\`);`)
  await db.run(sql`CREATE INDEX \`_articles_v_version_version_updated_at_idx\` ON \`_articles_v\` (\`version_updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_articles_v_version_version_created_at_idx\` ON \`_articles_v\` (\`version_created_at\`);`)
  await db.run(sql`CREATE INDEX \`_articles_v_version_version__status_idx\` ON \`_articles_v\` (\`version__status\`);`)
  await db.run(sql`CREATE INDEX \`_articles_v_created_at_idx\` ON \`_articles_v\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`_articles_v_updated_at_idx\` ON \`_articles_v\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_articles_v_latest_idx\` ON \`_articles_v\` (\`latest\`);`)
  await db.run(sql`CREATE TABLE \`_articles_v_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`keywords_id\` integer,
  	\`images_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`_articles_v\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`keywords_id\`) REFERENCES \`keywords\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`images_id\`) REFERENCES \`images\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`_articles_v_rels_order_idx\` ON \`_articles_v_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`_articles_v_rels_parent_idx\` ON \`_articles_v_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_articles_v_rels_path_idx\` ON \`_articles_v_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`_articles_v_rels_keywords_id_idx\` ON \`_articles_v_rels\` (\`keywords_id\`);`)
  await db.run(sql`CREATE INDEX \`_articles_v_rels_images_id_idx\` ON \`_articles_v_rels\` (\`images_id\`);`)
  await db.run(sql`CREATE TABLE \`article_reviews\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`article_id\` integer NOT NULL,
  	\`reviewer_id\` integer,
  	\`decision\` text NOT NULL,
  	\`comment\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`article_id\`) REFERENCES \`articles\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`reviewer_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`article_reviews_article_idx\` ON \`article_reviews\` (\`article_id\`);`)
  await db.run(sql`CREATE INDEX \`article_reviews_reviewer_idx\` ON \`article_reviews\` (\`reviewer_id\`);`)
  await db.run(sql`CREATE INDEX \`article_reviews_updated_at_idx\` ON \`article_reviews\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`article_reviews_created_at_idx\` ON \`article_reviews\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`article_reviews_texts\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer NOT NULL,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`text\` text,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`article_reviews\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`article_reviews_texts_order_parent\` ON \`article_reviews_texts\` (\`order\`,\`parent_id\`);`)
  await db.run(sql`CREATE TABLE \`tasks\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text NOT NULL,
  	\`description\` text,
  	\`status\` text DEFAULT 'inactive',
  	\`title_library_id\` integer,
  	\`keyword_library_id\` integer,
  	\`image_library_id\` integer,
  	\`prompt_id\` integer,
  	\`ai_model_id\` integer,
  	\`author_mode\` text DEFAULT 'fixed',
  	\`category_mode\` text DEFAULT 'fixed',
  	\`category_id\` integer,
  	\`publishing_pace_articles_per_day\` numeric DEFAULT 1,
  	\`publishing_pace_min_interval_minutes\` numeric DEFAULT 30,
  	\`publishing_pace_max_interval_minutes\` numeric DEFAULT 120,
  	\`auto_publish\` integer DEFAULT false,
  	\`last_run_at\` text,
  	\`total_runs\` numeric DEFAULT 0,
  	\`total_articles\` numeric DEFAULT 0,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`title_library_id\`) REFERENCES \`title_libraries\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`keyword_library_id\`) REFERENCES \`keyword_libraries\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`image_library_id\`) REFERENCES \`image_libraries\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`prompt_id\`) REFERENCES \`prompts\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`ai_model_id\`) REFERENCES \`ai_models\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`category_id\`) REFERENCES \`categories\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`tasks_title_library_idx\` ON \`tasks\` (\`title_library_id\`);`)
  await db.run(sql`CREATE INDEX \`tasks_keyword_library_idx\` ON \`tasks\` (\`keyword_library_id\`);`)
  await db.run(sql`CREATE INDEX \`tasks_image_library_idx\` ON \`tasks\` (\`image_library_id\`);`)
  await db.run(sql`CREATE INDEX \`tasks_prompt_idx\` ON \`tasks\` (\`prompt_id\`);`)
  await db.run(sql`CREATE INDEX \`tasks_ai_model_idx\` ON \`tasks\` (\`ai_model_id\`);`)
  await db.run(sql`CREATE INDEX \`tasks_category_idx\` ON \`tasks\` (\`category_id\`);`)
  await db.run(sql`CREATE INDEX \`tasks_updated_at_idx\` ON \`tasks\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`tasks_created_at_idx\` ON \`tasks\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`tasks_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`knowledge_bases_id\` integer,
  	\`authors_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`tasks\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`knowledge_bases_id\`) REFERENCES \`knowledge_bases\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`authors_id\`) REFERENCES \`authors\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`tasks_rels_order_idx\` ON \`tasks_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`tasks_rels_parent_idx\` ON \`tasks_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`tasks_rels_path_idx\` ON \`tasks_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`tasks_rels_knowledge_bases_id_idx\` ON \`tasks_rels\` (\`knowledge_bases_id\`);`)
  await db.run(sql`CREATE INDEX \`tasks_rels_authors_id_idx\` ON \`tasks_rels\` (\`authors_id\`);`)
  await db.run(sql`CREATE TABLE \`task_runs\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`task_id\` integer NOT NULL,
  	\`status\` text DEFAULT 'queued',
  	\`started_at\` text,
  	\`finished_at\` text,
  	\`duration_ms\` numeric,
  	\`token_usage\` text,
  	\`logs\` text,
  	\`error_message\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`task_id\`) REFERENCES \`tasks\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_runs_task_idx\` ON \`task_runs\` (\`task_id\`);`)
  await db.run(sql`CREATE INDEX \`task_runs_updated_at_idx\` ON \`task_runs\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_runs_created_at_idx\` ON \`task_runs\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`task_runs_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`articles_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`task_runs\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`articles_id\`) REFERENCES \`articles\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`task_runs_rels_order_idx\` ON \`task_runs_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`task_runs_rels_parent_idx\` ON \`task_runs_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`task_runs_rels_path_idx\` ON \`task_runs_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`task_runs_rels_articles_id_idx\` ON \`task_runs_rels\` (\`articles_id\`);`)
  await db.run(sql`CREATE TABLE \`task_schedules\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text NOT NULL,
  	\`task_id\` integer NOT NULL,
  	\`cron\` text NOT NULL,
  	\`timezone\` text DEFAULT 'Asia/Shanghai',
  	\`is_active\` integer DEFAULT true,
  	\`last_run_at\` text,
  	\`next_run_at\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`task_id\`) REFERENCES \`tasks\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`task_schedules_task_idx\` ON \`task_schedules\` (\`task_id\`);`)
  await db.run(sql`CREATE INDEX \`task_schedules_updated_at_idx\` ON \`task_schedules\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`task_schedules_created_at_idx\` ON \`task_schedules\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`worker_heartbeats\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`worker_id\` text NOT NULL,
  	\`queue\` text,
  	\`hostname\` text,
  	\`pid\` numeric,
  	\`status\` text DEFAULT 'idle',
  	\`last_heartbeat_at\` text,
  	\`metrics\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`worker_heartbeats_worker_id_idx\` ON \`worker_heartbeats\` (\`worker_id\`);`)
  await db.run(sql`CREATE INDEX \`worker_heartbeats_updated_at_idx\` ON \`worker_heartbeats\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`worker_heartbeats_created_at_idx\` ON \`worker_heartbeats\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`agent_skills_files\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`path\` text,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`agent_skills\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`agent_skills_files_order_idx\` ON \`agent_skills_files\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`agent_skills_files_parent_id_idx\` ON \`agent_skills_files\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`agent_skills\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`is_active\` integer DEFAULT true,
  	\`slug\` text,
  	\`name\` text NOT NULL,
  	\`description\` text,
  	\`content\` text,
  	\`raw_skill_md\` text,
  	\`file_count\` numeric,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`url\` text,
  	\`thumbnail_u_r_l\` text,
  	\`filename\` text,
  	\`mime_type\` text,
  	\`filesize\` numeric,
  	\`width\` numeric,
  	\`height\` numeric,
  	\`focal_x\` numeric,
  	\`focal_y\` numeric
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`agent_skills_slug_idx\` ON \`agent_skills\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`agent_skills_updated_at_idx\` ON \`agent_skills\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`agent_skills_created_at_idx\` ON \`agent_skills\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`agent_skills_filename_idx\` ON \`agent_skills\` (\`filename\`);`)
  await db.run(sql`CREATE TABLE \`agent_tasks_variables\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`key\` text NOT NULL,
  	\`label\` text,
  	\`default_value\` text,
  	\`description\` text,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`agent_tasks\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`agent_tasks_variables_order_idx\` ON \`agent_tasks_variables\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`agent_tasks_variables_parent_id_idx\` ON \`agent_tasks_variables\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`agent_tasks\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text NOT NULL,
  	\`slug\` text,
  	\`prompt\` text NOT NULL,
  	\`output_mode\` text DEFAULT 'text',
  	\`ai_model_id\` integer NOT NULL,
  	\`max_steps\` numeric DEFAULT 20,
  	\`timeout_ms\` numeric DEFAULT 300000,
  	\`enable_bash\` integer DEFAULT true,
  	\`last_run_at\` text,
  	\`last_run_status\` text DEFAULT 'idle',
  	\`total_runs\` numeric DEFAULT 0,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`ai_model_id\`) REFERENCES \`ai_models\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`agent_tasks_slug_idx\` ON \`agent_tasks\` (\`slug\`);`)
  await db.run(sql`CREATE INDEX \`agent_tasks_ai_model_idx\` ON \`agent_tasks\` (\`ai_model_id\`);`)
  await db.run(sql`CREATE INDEX \`agent_tasks_updated_at_idx\` ON \`agent_tasks\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`agent_tasks_created_at_idx\` ON \`agent_tasks\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`agent_tasks_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`agent_skills_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`agent_tasks\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`agent_skills_id\`) REFERENCES \`agent_skills\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`agent_tasks_rels_order_idx\` ON \`agent_tasks_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`agent_tasks_rels_parent_idx\` ON \`agent_tasks_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`agent_tasks_rels_path_idx\` ON \`agent_tasks_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`agent_tasks_rels_agent_skills_id_idx\` ON \`agent_tasks_rels\` (\`agent_skills_id\`);`)
  await db.run(sql`CREATE TABLE \`agent_task_runs\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`agent_task_id\` integer NOT NULL,
  	\`status\` text DEFAULT 'queued',
  	\`started_at\` text,
  	\`finished_at\` text,
  	\`duration_ms\` numeric,
  	\`inputs\` text,
  	\`effective_prompt\` text,
  	\`linked_knowledge_base_id\` integer,
  	\`final_output\` text,
  	\`error_message\` text,
  	\`steps\` text,
  	\`step_count\` numeric,
  	\`total_tokens\` numeric,
  	\`prompt_tokens\` numeric,
  	\`completion_tokens\` numeric,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`agent_task_id\`) REFERENCES \`agent_tasks\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`linked_knowledge_base_id\`) REFERENCES \`knowledge_bases\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`agent_task_runs_agent_task_idx\` ON \`agent_task_runs\` (\`agent_task_id\`);`)
  await db.run(sql`CREATE INDEX \`agent_task_runs_status_idx\` ON \`agent_task_runs\` (\`status\`);`)
  await db.run(sql`CREATE INDEX \`agent_task_runs_linked_knowledge_base_idx\` ON \`agent_task_runs\` (\`linked_knowledge_base_id\`);`)
  await db.run(sql`CREATE INDEX \`agent_task_runs_updated_at_idx\` ON \`agent_task_runs\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`agent_task_runs_created_at_idx\` ON \`agent_task_runs\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`sensitive_words\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`word\` text NOT NULL,
  	\`severity\` text DEFAULT 'medium',
  	\`action\` text DEFAULT 'flag',
  	\`replacement\` text,
  	\`category\` text,
  	\`is_active\` integer DEFAULT true,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`sensitive_words_word_idx\` ON \`sensitive_words\` (\`word\`);`)
  await db.run(sql`CREATE INDEX \`sensitive_words_updated_at_idx\` ON \`sensitive_words\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`sensitive_words_created_at_idx\` ON \`sensitive_words\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`activity_logs\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`user_id\` integer,
  	\`action\` text NOT NULL,
  	\`target_type\` text,
  	\`target_id\` text,
  	\`ip\` text,
  	\`user_agent\` text,
  	\`metadata\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`activity_logs_user_idx\` ON \`activity_logs\` (\`user_id\`);`)
  await db.run(sql`CREATE INDEX \`activity_logs_updated_at_idx\` ON \`activity_logs\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`activity_logs_created_at_idx\` ON \`activity_logs\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`system_logs\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`level\` text DEFAULT 'info' NOT NULL,
  	\`channel\` text,
  	\`message\` text NOT NULL,
  	\`context\` text,
  	\`stack\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`system_logs_updated_at_idx\` ON \`system_logs\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`system_logs_created_at_idx\` ON \`system_logs\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`url_import_jobs_urls\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`url\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`url_import_jobs\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`url_import_jobs_urls_order_idx\` ON \`url_import_jobs_urls\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`url_import_jobs_urls_parent_id_idx\` ON \`url_import_jobs_urls\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`url_import_jobs\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text NOT NULL,
  	\`source_type\` text DEFAULT 'list',
  	\`feed_url\` text,
  	\`target_category_id\` integer,
  	\`target_knowledge_base_id\` integer,
  	\`status\` text DEFAULT 'pending',
  	\`total_urls\` numeric DEFAULT 0,
  	\`processed_urls\` numeric DEFAULT 0,
  	\`failed_urls\` numeric DEFAULT 0,
  	\`started_at\` text,
  	\`finished_at\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`target_category_id\`) REFERENCES \`categories\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`target_knowledge_base_id\`) REFERENCES \`knowledge_bases\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`url_import_jobs_target_category_idx\` ON \`url_import_jobs\` (\`target_category_id\`);`)
  await db.run(sql`CREATE INDEX \`url_import_jobs_target_knowledge_base_idx\` ON \`url_import_jobs\` (\`target_knowledge_base_id\`);`)
  await db.run(sql`CREATE INDEX \`url_import_jobs_updated_at_idx\` ON \`url_import_jobs\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`url_import_jobs_created_at_idx\` ON \`url_import_jobs\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`url_import_job_logs\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`job_id\` integer NOT NULL,
  	\`url\` text NOT NULL,
  	\`status\` text NOT NULL,
  	\`http_status\` numeric,
  	\`extracted_title\` text,
  	\`content_length\` numeric,
  	\`created_article_id\` integer,
  	\`created_knowledge_base_id\` integer,
  	\`error_message\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`job_id\`) REFERENCES \`url_import_jobs\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`created_article_id\`) REFERENCES \`articles\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`created_knowledge_base_id\`) REFERENCES \`knowledge_bases\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`url_import_job_logs_job_idx\` ON \`url_import_job_logs\` (\`job_id\`);`)
  await db.run(sql`CREATE INDEX \`url_import_job_logs_created_article_idx\` ON \`url_import_job_logs\` (\`created_article_id\`);`)
  await db.run(sql`CREATE INDEX \`url_import_job_logs_created_knowledge_base_idx\` ON \`url_import_job_logs\` (\`created_knowledge_base_id\`);`)
  await db.run(sql`CREATE INDEX \`url_import_job_logs_updated_at_idx\` ON \`url_import_job_logs\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`url_import_job_logs_created_at_idx\` ON \`url_import_job_logs\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_mcp_api_keys\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`user_id\` integer NOT NULL,
  	\`label\` text,
  	\`description\` text,
  	\`articles_find\` integer DEFAULT false,
  	\`articles_create\` integer DEFAULT false,
  	\`articles_update\` integer DEFAULT false,
  	\`tasks_find\` integer DEFAULT false,
  	\`tasks_create\` integer DEFAULT false,
  	\`tasks_update\` integer DEFAULT false,
  	\`prompts_find\` integer DEFAULT false,
  	\`prompts_create\` integer DEFAULT false,
  	\`prompts_update\` integer DEFAULT false,
  	\`knowledge_bases_find\` integer DEFAULT false,
  	\`titles_find\` integer DEFAULT false,
  	\`titles_create\` integer DEFAULT false,
  	\`titles_update\` integer DEFAULT false,
  	\`keywords_find\` integer DEFAULT false,
  	\`keywords_create\` integer DEFAULT false,
  	\`keywords_update\` integer DEFAULT false,
  	\`categories_find\` integer DEFAULT false,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`enable_a_p_i_key\` integer,
  	\`api_key\` text,
  	\`api_key_index\` text,
  	FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_mcp_api_keys_user_idx\` ON \`payload_mcp_api_keys\` (\`user_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_mcp_api_keys_updated_at_idx\` ON \`payload_mcp_api_keys\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_mcp_api_keys_created_at_idx\` ON \`payload_mcp_api_keys\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_kv\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`key\` text NOT NULL,
  	\`data\` text NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`payload_kv_key_idx\` ON \`payload_kv\` (\`key\`);`)
  await db.run(sql`CREATE TABLE \`payload_jobs_log\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`executed_at\` text NOT NULL,
  	\`completed_at\` text NOT NULL,
  	\`task_slug\` text NOT NULL,
  	\`task_i_d\` text NOT NULL,
  	\`input\` text,
  	\`output\` text,
  	\`state\` text NOT NULL,
  	\`error\` text,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`payload_jobs\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_jobs_log_order_idx\` ON \`payload_jobs_log\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`payload_jobs_log_parent_id_idx\` ON \`payload_jobs_log\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`payload_jobs\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`input\` text,
  	\`completed_at\` text,
  	\`total_tried\` numeric DEFAULT 0,
  	\`has_error\` integer DEFAULT false,
  	\`error\` text,
  	\`task_slug\` text,
  	\`queue\` text DEFAULT 'default',
  	\`wait_until\` text,
  	\`processing\` integer DEFAULT false,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_jobs_completed_at_idx\` ON \`payload_jobs\` (\`completed_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_jobs_total_tried_idx\` ON \`payload_jobs\` (\`total_tried\`);`)
  await db.run(sql`CREATE INDEX \`payload_jobs_has_error_idx\` ON \`payload_jobs\` (\`has_error\`);`)
  await db.run(sql`CREATE INDEX \`payload_jobs_task_slug_idx\` ON \`payload_jobs\` (\`task_slug\`);`)
  await db.run(sql`CREATE INDEX \`payload_jobs_queue_idx\` ON \`payload_jobs\` (\`queue\`);`)
  await db.run(sql`CREATE INDEX \`payload_jobs_wait_until_idx\` ON \`payload_jobs\` (\`wait_until\`);`)
  await db.run(sql`CREATE INDEX \`payload_jobs_processing_idx\` ON \`payload_jobs\` (\`processing\`);`)
  await db.run(sql`CREATE INDEX \`payload_jobs_updated_at_idx\` ON \`payload_jobs\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_jobs_created_at_idx\` ON \`payload_jobs\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_locked_documents\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`global_slug\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_global_slug_idx\` ON \`payload_locked_documents\` (\`global_slug\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_updated_at_idx\` ON \`payload_locked_documents\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_created_at_idx\` ON \`payload_locked_documents\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_locked_documents_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	\`authors_id\` integer,
  	\`tags_id\` integer,
  	\`title_libraries_id\` integer,
  	\`titles_id\` integer,
  	\`keyword_libraries_id\` integer,
  	\`keywords_id\` integer,
  	\`image_libraries_id\` integer,
  	\`images_id\` integer,
  	\`knowledge_bases_id\` integer,
  	\`knowledge_chunks_id\` integer,
  	\`kb_uploads_id\` integer,
  	\`kb_index_runs_id\` integer,
  	\`ai_models_id\` integer,
  	\`prompts_id\` integer,
  	\`categories_id\` integer,
  	\`articles_id\` integer,
  	\`article_reviews_id\` integer,
  	\`tasks_id\` integer,
  	\`task_runs_id\` integer,
  	\`task_schedules_id\` integer,
  	\`worker_heartbeats_id\` integer,
  	\`agent_skills_id\` integer,
  	\`agent_tasks_id\` integer,
  	\`agent_task_runs_id\` integer,
  	\`sensitive_words_id\` integer,
  	\`activity_logs_id\` integer,
  	\`system_logs_id\` integer,
  	\`url_import_jobs_id\` integer,
  	\`url_import_job_logs_id\` integer,
  	\`payload_mcp_api_keys_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_locked_documents\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`authors_id\`) REFERENCES \`authors\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`tags_id\`) REFERENCES \`tags\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`title_libraries_id\`) REFERENCES \`title_libraries\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`titles_id\`) REFERENCES \`titles\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`keyword_libraries_id\`) REFERENCES \`keyword_libraries\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`keywords_id\`) REFERENCES \`keywords\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`image_libraries_id\`) REFERENCES \`image_libraries\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`images_id\`) REFERENCES \`images\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`knowledge_bases_id\`) REFERENCES \`knowledge_bases\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`knowledge_chunks_id\`) REFERENCES \`knowledge_chunks\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`kb_uploads_id\`) REFERENCES \`kb_uploads\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`kb_index_runs_id\`) REFERENCES \`kb_index_runs\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`ai_models_id\`) REFERENCES \`ai_models\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`prompts_id\`) REFERENCES \`prompts\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`categories_id\`) REFERENCES \`categories\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`articles_id\`) REFERENCES \`articles\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`article_reviews_id\`) REFERENCES \`article_reviews\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`tasks_id\`) REFERENCES \`tasks\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`task_runs_id\`) REFERENCES \`task_runs\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`task_schedules_id\`) REFERENCES \`task_schedules\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`worker_heartbeats_id\`) REFERENCES \`worker_heartbeats\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`agent_skills_id\`) REFERENCES \`agent_skills\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`agent_tasks_id\`) REFERENCES \`agent_tasks\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`agent_task_runs_id\`) REFERENCES \`agent_task_runs\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`sensitive_words_id\`) REFERENCES \`sensitive_words\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`activity_logs_id\`) REFERENCES \`activity_logs\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`system_logs_id\`) REFERENCES \`system_logs\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`url_import_jobs_id\`) REFERENCES \`url_import_jobs\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`url_import_job_logs_id\`) REFERENCES \`url_import_job_logs\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`payload_mcp_api_keys_id\`) REFERENCES \`payload_mcp_api_keys\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_order_idx\` ON \`payload_locked_documents_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_parent_idx\` ON \`payload_locked_documents_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_path_idx\` ON \`payload_locked_documents_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_users_id_idx\` ON \`payload_locked_documents_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_authors_id_idx\` ON \`payload_locked_documents_rels\` (\`authors_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_tags_id_idx\` ON \`payload_locked_documents_rels\` (\`tags_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_title_libraries_id_idx\` ON \`payload_locked_documents_rels\` (\`title_libraries_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_titles_id_idx\` ON \`payload_locked_documents_rels\` (\`titles_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_keyword_libraries_id_idx\` ON \`payload_locked_documents_rels\` (\`keyword_libraries_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_keywords_id_idx\` ON \`payload_locked_documents_rels\` (\`keywords_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_image_libraries_id_idx\` ON \`payload_locked_documents_rels\` (\`image_libraries_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_images_id_idx\` ON \`payload_locked_documents_rels\` (\`images_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_knowledge_bases_id_idx\` ON \`payload_locked_documents_rels\` (\`knowledge_bases_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_knowledge_chunks_id_idx\` ON \`payload_locked_documents_rels\` (\`knowledge_chunks_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_kb_uploads_id_idx\` ON \`payload_locked_documents_rels\` (\`kb_uploads_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_kb_index_runs_id_idx\` ON \`payload_locked_documents_rels\` (\`kb_index_runs_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_ai_models_id_idx\` ON \`payload_locked_documents_rels\` (\`ai_models_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_prompts_id_idx\` ON \`payload_locked_documents_rels\` (\`prompts_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_categories_id_idx\` ON \`payload_locked_documents_rels\` (\`categories_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_articles_id_idx\` ON \`payload_locked_documents_rels\` (\`articles_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_article_reviews_id_idx\` ON \`payload_locked_documents_rels\` (\`article_reviews_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_tasks_id_idx\` ON \`payload_locked_documents_rels\` (\`tasks_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_runs_id_idx\` ON \`payload_locked_documents_rels\` (\`task_runs_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_task_schedules_id_idx\` ON \`payload_locked_documents_rels\` (\`task_schedules_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_worker_heartbeats_id_idx\` ON \`payload_locked_documents_rels\` (\`worker_heartbeats_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_agent_skills_id_idx\` ON \`payload_locked_documents_rels\` (\`agent_skills_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_agent_tasks_id_idx\` ON \`payload_locked_documents_rels\` (\`agent_tasks_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_agent_task_runs_id_idx\` ON \`payload_locked_documents_rels\` (\`agent_task_runs_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_sensitive_words_id_idx\` ON \`payload_locked_documents_rels\` (\`sensitive_words_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_activity_logs_id_idx\` ON \`payload_locked_documents_rels\` (\`activity_logs_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_system_logs_id_idx\` ON \`payload_locked_documents_rels\` (\`system_logs_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_url_import_jobs_id_idx\` ON \`payload_locked_documents_rels\` (\`url_import_jobs_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_url_import_job_logs_id_idx\` ON \`payload_locked_documents_rels\` (\`url_import_job_logs_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_payload_mcp_api_keys_id_idx\` ON \`payload_locked_documents_rels\` (\`payload_mcp_api_keys_id\`);`)
  await db.run(sql`CREATE TABLE \`payload_preferences\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`key\` text,
  	\`value\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_preferences_key_idx\` ON \`payload_preferences\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_updated_at_idx\` ON \`payload_preferences\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_created_at_idx\` ON \`payload_preferences\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_preferences_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	\`payload_mcp_api_keys_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_preferences\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`payload_mcp_api_keys_id\`) REFERENCES \`payload_mcp_api_keys\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_order_idx\` ON \`payload_preferences_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_parent_idx\` ON \`payload_preferences_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_path_idx\` ON \`payload_preferences_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_users_id_idx\` ON \`payload_preferences_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_payload_mcp_api_keys_id_idx\` ON \`payload_preferences_rels\` (\`payload_mcp_api_keys_id\`);`)
  await db.run(sql`CREATE TABLE \`payload_migrations\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text,
  	\`batch\` numeric,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_migrations_updated_at_idx\` ON \`payload_migrations\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_migrations_created_at_idx\` ON \`payload_migrations\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`site_settings\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`site_name\` text NOT NULL,
  	\`site_tagline\` text,
  	\`site_description\` text,
  	\`site_url\` text,
  	\`site_logo_id\` integer,
  	\`site_favicon_id\` integer,
  	\`theme_mode\` text DEFAULT 'auto',
  	\`theme_primary_color\` text DEFAULT '#3b82f6',
  	\`seo_default_meta_title\` text,
  	\`seo_default_meta_description\` text,
  	\`seo_default_og_image_id\` integer,
  	\`security_max_login_attempts\` numeric DEFAULT 5,
  	\`security_lockout_minutes\` numeric DEFAULT 15,
  	\`security_session_timeout_minutes\` numeric DEFAULT 120,
  	\`upload_max_file_size_m_b\` numeric DEFAULT 10,
  	\`updated_at\` text,
  	\`created_at\` text,
  	FOREIGN KEY (\`site_logo_id\`) REFERENCES \`images\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`site_favicon_id\`) REFERENCES \`images\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`seo_default_og_image_id\`) REFERENCES \`images\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`site_settings_site_site_logo_idx\` ON \`site_settings\` (\`site_logo_id\`);`)
  await db.run(sql`CREATE INDEX \`site_settings_site_site_favicon_idx\` ON \`site_settings\` (\`site_favicon_id\`);`)
  await db.run(sql`CREATE INDEX \`site_settings_seo_seo_default_og_image_idx\` ON \`site_settings\` (\`seo_default_og_image_id\`);`)
  await db.run(sql`CREATE TABLE \`site_settings_texts\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer NOT NULL,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`text\` text,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`site_settings\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`site_settings_texts_order_parent\` ON \`site_settings_texts\` (\`order\`,\`parent_id\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`users_sessions\`;`)
  await db.run(sql`DROP TABLE \`users\`;`)
  await db.run(sql`DROP TABLE \`authors\`;`)
  await db.run(sql`DROP TABLE \`tags\`;`)
  await db.run(sql`DROP TABLE \`title_libraries\`;`)
  await db.run(sql`DROP TABLE \`titles\`;`)
  await db.run(sql`DROP TABLE \`titles_texts\`;`)
  await db.run(sql`DROP TABLE \`keyword_libraries\`;`)
  await db.run(sql`DROP TABLE \`keywords\`;`)
  await db.run(sql`DROP TABLE \`keywords_rels\`;`)
  await db.run(sql`DROP TABLE \`image_libraries\`;`)
  await db.run(sql`DROP TABLE \`images\`;`)
  await db.run(sql`DROP TABLE \`images_rels\`;`)
  await db.run(sql`DROP TABLE \`knowledge_bases\`;`)
  await db.run(sql`DROP TABLE \`knowledge_chunks\`;`)
  await db.run(sql`DROP TABLE \`kb_uploads\`;`)
  await db.run(sql`DROP TABLE \`kb_index_runs\`;`)
  await db.run(sql`DROP TABLE \`ai_models\`;`)
  await db.run(sql`DROP TABLE \`prompts_variables\`;`)
  await db.run(sql`DROP TABLE \`prompts\`;`)
  await db.run(sql`DROP TABLE \`categories\`;`)
  await db.run(sql`DROP TABLE \`articles\`;`)
  await db.run(sql`DROP TABLE \`articles_rels\`;`)
  await db.run(sql`DROP TABLE \`_articles_v\`;`)
  await db.run(sql`DROP TABLE \`_articles_v_rels\`;`)
  await db.run(sql`DROP TABLE \`article_reviews\`;`)
  await db.run(sql`DROP TABLE \`article_reviews_texts\`;`)
  await db.run(sql`DROP TABLE \`tasks\`;`)
  await db.run(sql`DROP TABLE \`tasks_rels\`;`)
  await db.run(sql`DROP TABLE \`task_runs\`;`)
  await db.run(sql`DROP TABLE \`task_runs_rels\`;`)
  await db.run(sql`DROP TABLE \`task_schedules\`;`)
  await db.run(sql`DROP TABLE \`worker_heartbeats\`;`)
  await db.run(sql`DROP TABLE \`agent_skills_files\`;`)
  await db.run(sql`DROP TABLE \`agent_skills\`;`)
  await db.run(sql`DROP TABLE \`agent_tasks_variables\`;`)
  await db.run(sql`DROP TABLE \`agent_tasks\`;`)
  await db.run(sql`DROP TABLE \`agent_tasks_rels\`;`)
  await db.run(sql`DROP TABLE \`agent_task_runs\`;`)
  await db.run(sql`DROP TABLE \`sensitive_words\`;`)
  await db.run(sql`DROP TABLE \`activity_logs\`;`)
  await db.run(sql`DROP TABLE \`system_logs\`;`)
  await db.run(sql`DROP TABLE \`url_import_jobs_urls\`;`)
  await db.run(sql`DROP TABLE \`url_import_jobs\`;`)
  await db.run(sql`DROP TABLE \`url_import_job_logs\`;`)
  await db.run(sql`DROP TABLE \`payload_mcp_api_keys\`;`)
  await db.run(sql`DROP TABLE \`payload_kv\`;`)
  await db.run(sql`DROP TABLE \`payload_jobs_log\`;`)
  await db.run(sql`DROP TABLE \`payload_jobs\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_preferences\`;`)
  await db.run(sql`DROP TABLE \`payload_preferences_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_migrations\`;`)
  await db.run(sql`DROP TABLE \`site_settings\`;`)
  await db.run(sql`DROP TABLE \`site_settings_texts\`;`)
}
