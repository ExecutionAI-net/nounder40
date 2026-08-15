-- Modalità di pagamento del compenso insegnante (bonifico / contanti / carta)
ALTER TABLE teacher_compensation_payments
  ADD COLUMN IF NOT EXISTS payment_method TEXT;
