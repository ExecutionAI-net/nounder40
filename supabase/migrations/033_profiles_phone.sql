-- Phone number on profiles (HQ team member contact)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone TEXT;
