import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const LOCALES = ['en', 'it', 'es', 'fr', 'de']

const enValues = [
  // auth.login
  { key: 'auth.login.signIn', value: 'Sign in to your account' },
  { key: 'auth.login.continueWithGoogle', value: 'Continue with Google' },
  { key: 'auth.login.orContinueWithEmail', value: 'or continue with email' },
  { key: 'auth.login.emailLabel', value: 'Email' },
  { key: 'auth.login.passwordLabel', value: 'Password' },
  { key: 'auth.login.forgotPassword', value: 'Forgot password?' },
  { key: 'auth.login.signingIn', value: 'Signing in...' },
  { key: 'auth.login.signInButton', value: 'Sign in' },
  { key: 'auth.login.noAccount', value: "Don't have an account?" },
  { key: 'auth.login.register', value: 'Register' },
  { key: 'auth.login.passwordUpdated', value: 'Password updated successfully. You can now sign in.' },
  { key: 'auth.login.failedProfile', value: 'Failed to load profile. Please refresh.' },
  { key: 'auth.login.resetPassword', value: 'Reset your password' },
  { key: 'auth.login.checkEmail', value: 'Check your email' },
  { key: 'auth.login.sendResetLink', value: 'Send reset link' },
  { key: 'auth.login.sending', value: 'Sending...' },
  { key: 'auth.login.backToLogin', value: 'Back to login' },
  { key: 'auth.login.resetEmailSent', value: 'We sent a password reset link to {email}. Check your inbox and follow the link.' },
  { key: 'auth.login.failedResetEmail', value: 'Failed to send reset email' },
  // auth.register
  { key: 'auth.register.subtitle', value: 'Create your student account' },
  { key: 'auth.register.yourProfile', value: 'Your profile' },
  { key: 'auth.register.accountDetails', value: 'Account details' },
  { key: 'auth.register.fullNameLabel', value: 'Full Name *' },
  { key: 'auth.register.fullNamePlaceholder', value: 'First and last name' },
  { key: 'auth.register.phoneLabel', value: 'Phone' },
  { key: 'auth.register.dateOfBirthLabel', value: 'Date of Birth' },
  { key: 'auth.register.cityLabel', value: 'City' },
  { key: 'auth.register.cityPlaceholder', value: 'e.g. Milano' },
  { key: 'auth.register.countryLabel', value: 'Country' },
  { key: 'auth.register.emailLabel', value: 'Email *' },
  { key: 'auth.register.emailPlaceholder', value: 'you@example.com' },
  { key: 'auth.register.passwordLabel', value: 'Password *' },
  { key: 'auth.register.passwordPlaceholder', value: 'Create a password' },
  { key: 'auth.register.continueButton', value: 'Continue' },
  { key: 'auth.register.backButton', value: 'Back' },
  { key: 'auth.register.creatingAccount', value: 'Creating account...' },
  { key: 'auth.register.createAccount', value: 'Create Account' },
  { key: 'auth.register.alreadyHaveAccount', value: 'Already have an account?' },
  { key: 'auth.register.signIn', value: 'Sign in' },
  { key: 'auth.register.fullNameRequired', value: 'Full name is required.' },
  { key: 'auth.register.emailRequired', value: 'Email is required.' },
  { key: 'auth.register.passwordRequired', value: 'Password is required.' },
  { key: 'auth.register.accountExists', value: 'An account with this email already exists. Please sign in or use a different email.' },
  { key: 'auth.register.registrationFailed', value: 'Registration failed.' },
  { key: 'auth.register.verifyEmail', value: 'Verify your email' },
  { key: 'auth.register.verifyEmailDesc', value: 'We sent a confirmation link to {email}. Click the link to activate your account.' },
  { key: 'auth.register.backToLogin', value: 'Back to login' },
  // auth.resetPassword
  { key: 'auth.resetPassword.title', value: 'Set a new password' },
  { key: 'auth.resetPassword.newPasswordLabel', value: 'New Password' },
  { key: 'auth.resetPassword.newPasswordPlaceholder', value: 'Min. 6 characters' },
  { key: 'auth.resetPassword.confirmPasswordLabel', value: 'Confirm Password' },
  { key: 'auth.resetPassword.confirmPasswordPlaceholder', value: 'Repeat new password' },
  { key: 'auth.resetPassword.saving', value: 'Saving...' },
  { key: 'auth.resetPassword.saveButton', value: 'Save new password' },
  { key: 'auth.resetPassword.passwordTooShort', value: 'Password must be at least 6 characters.' },
  { key: 'auth.resetPassword.passwordMismatch', value: 'Passwords do not match.' },
  // auth.selectRole
  { key: 'auth.selectRole.loading', value: 'Loading...' },
  { key: 'auth.selectRole.welcomeBack', value: 'Welcome back, {name}' },
  { key: 'auth.selectRole.selectDashboard', value: 'Select your dashboard' },
  { key: 'auth.selectRole.multipleAreas', value: 'Your account has access to multiple areas.' },
  { key: 'auth.selectRole.roles.hq.label', value: 'HQ Panel' },
  { key: 'auth.selectRole.roles.hq.description', value: 'Manage the network, schools, and platform settings' },
  { key: 'auth.selectRole.roles.school.label', value: 'School Panel' },
  { key: 'auth.selectRole.roles.school.description', value: 'Manage your school, lessons, and students' },
  { key: 'auth.selectRole.roles.teacher.label', value: 'Teacher Panel' },
  { key: 'auth.selectRole.roles.teacher.description', value: 'View your schedule and mark attendance' },
  { key: 'auth.selectRole.roles.student.label', value: 'Student Panel' },
  { key: 'auth.selectRole.roles.student.description', value: 'Book lessons and manage your packages' },
  // auth.setup
  { key: 'auth.setup.subtitle', value: 'Set up your account' },
  { key: 'auth.setup.welcome', value: 'Welcome!' },
  { key: 'auth.setup.welcomeDesc', value: 'Please set your name and create a password to get started.' },
  { key: 'auth.setup.fullNameLabel', value: 'Full Name *' },
  { key: 'auth.setup.fullNamePlaceholder', value: 'Your full name' },
  { key: 'auth.setup.passwordLabel', value: 'Password *' },
  { key: 'auth.setup.passwordPlaceholder', value: 'Min. 8 characters' },
  { key: 'auth.setup.confirmPasswordLabel', value: 'Confirm Password *' },
  { key: 'auth.setup.confirmPasswordPlaceholder', value: 'Repeat password' },
  { key: 'auth.setup.settingUp', value: 'Setting up...' },
  { key: 'auth.setup.completeSetup', value: 'Complete Setup' },
  { key: 'auth.setup.loading', value: 'Loading...' },
  { key: 'auth.setup.nameRequired', value: 'Please enter your name.' },
  { key: 'auth.setup.passwordTooShort', value: 'Password must be at least 8 characters.' },
  { key: 'auth.setup.passwordMismatch', value: 'Passwords do not match.' },
]

// Rows: en values + empty rows for other locales for dynamic keys
const rows = enValues.map(({ key, value }) => ({ key, locale: 'en', value }))

const dynamicKeys = [
  'auth.selectRole.roles.hq.label', 'auth.selectRole.roles.hq.description',
  'auth.selectRole.roles.school.label', 'auth.selectRole.roles.school.description',
  'auth.selectRole.roles.teacher.label', 'auth.selectRole.roles.teacher.description',
  'auth.selectRole.roles.student.label', 'auth.selectRole.roles.student.description',
]
for (const key of dynamicKeys) {
  for (const locale of ['it', 'es', 'fr', 'de']) {
    rows.push({ key, locale, value: '' })
  }
}

const { error } = await sb.from('translations').upsert(rows, { onConflict: 'key,locale' })
if (error) console.error('Error:', error.message)
else console.log(`Set English values for ${enValues.length} auth keys`)
