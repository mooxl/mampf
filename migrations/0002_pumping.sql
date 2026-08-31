CREATE TABLE IF NOT EXISTS pumpings (
  id TEXT PRIMARY KEY,
  side TEXT NOT NULL,
  durationMin INTEGER NOT NULL,
  amountMl INTEGER NOT NULL,
  pumpedAt TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pumpings_pumpedAt ON pumpings (pumpedAt);
