CREATE TABLE IF NOT EXISTS feedings (
  id TEXT PRIMARY KEY,
  amountMl INTEGER NOT NULL,
  fedAt TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feedings_fedAt ON feedings (fedAt);
