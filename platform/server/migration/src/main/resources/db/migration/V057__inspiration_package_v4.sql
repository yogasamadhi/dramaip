ALTER TABLE ai_gateway.inspiration_project_previews
  ADD COLUMN corpus_item_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE ai_gateway.inspiration_project_previews
  ADD CONSTRAINT inspiration_preview_corpus_item_ids_array
  CHECK (jsonb_typeof(corpus_item_ids) = 'array');
