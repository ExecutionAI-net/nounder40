#!/usr/bin/env node
/**
 * Populate the My Account + login-error translations for all 5 locales.
 * Run once: node scripts/fill-account-translations.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const db = createClient(url, key)

// [key, { en, it, es, fr, de }]
const translations = {
  // ── Account page ──────────────────────────────────────────────────
  'account.title': {
    en: 'My Account',
    it: 'Il mio account',
    es: 'Mi cuenta',
    fr: 'Mon compte',
    de: 'Mein Konto',
  },
  'account.subtitle': {
    en: 'Manage your personal profile, security and membership.',
    it: 'Gestisci il tuo profilo, la sicurezza e la tua iscrizione.',
    es: 'Gestiona tu perfil, seguridad y membresía.',
    fr: 'Gérez votre profil, la sécurité et votre adhésion.',
    de: 'Verwalte dein Profil, deine Sicherheit und Mitgliedschaft.',
  },
  'account.notFound': {
    en: 'Profile not found.',
    it: 'Profilo non trovato.',
    es: 'Perfil no encontrado.',
    fr: 'Profil introuvable.',
    de: 'Profil nicht gefunden.',
  },

  // Tabs
  'account.tabAccount':    { en: 'Account',    it: 'Account',    es: 'Cuenta',       fr: 'Compte',     de: 'Konto' },
  'account.tabSecurity':   { en: 'Security',   it: 'Sicurezza',  es: 'Seguridad',    fr: 'Sécurité',   de: 'Sicherheit' },
  'account.tabMembership': { en: 'Membership', it: 'Iscrizione', es: 'Membresía',    fr: 'Adhésion',   de: 'Mitgliedschaft' },

  // Account tab
  'account.labelFullName': { en: 'Full name', it: 'Nome e cognome', es: 'Nombre completo', fr: 'Nom complet',   de: 'Vollständiger Name' },
  'account.labelEmail':    { en: 'Email',     it: 'Email',          es: 'Correo',           fr: 'E-mail',        de: 'E-Mail' },
  'account.labelPhone':    { en: 'Phone',     it: 'Telefono',       es: 'Teléfono',         fr: 'Téléphone',     de: 'Telefon' },
  'account.labelLanguage': { en: 'Language',  it: 'Lingua',         es: 'Idioma',           fr: 'Langue',        de: 'Sprache' },
  'account.emailHint': {
    en: 'Email changes are not supported from the UI — contact support.',
    it: 'Non puoi cambiare l\'email dall\'interfaccia — contatta il supporto.',
    es: 'Los cambios de correo no se admiten desde la interfaz — contacta con soporte.',
    fr: 'Les modifications d\'e-mail ne sont pas prises en charge depuis l\'interface — contactez le support.',
    de: 'E-Mail-Änderungen sind über die Oberfläche nicht möglich — bitte den Support kontaktieren.',
  },
  'account.saveChanges': { en: 'Save changes', it: 'Salva modifiche', es: 'Guardar cambios', fr: 'Enregistrer les modifications', de: 'Änderungen speichern' },
  'account.saving':      { en: 'Saving…',      it: 'Salvataggio…',    es: 'Guardando…',        fr: 'Enregistrement…',                 de: 'Speichern…' },
  'account.saved':       { en: 'Saved.',       it: 'Salvato.',         es: 'Guardado.',          fr: 'Enregistré.',                      de: 'Gespeichert.' },
  'account.saveFailed':  { en: 'Save failed',  it: 'Salvataggio non riuscito', es: 'Error al guardar', fr: 'Échec de l\'enregistrement', de: 'Speichern fehlgeschlagen' },

  // Security tab
  'account.changePassword':       { en: 'Change password', it: 'Cambia password', es: 'Cambiar contraseña', fr: 'Changer le mot de passe', de: 'Passwort ändern' },
  'account.labelCurrentPassword': { en: 'Current password', it: 'Password attuale',   es: 'Contraseña actual', fr: 'Mot de passe actuel',   de: 'Aktuelles Passwort' },
  'account.labelNewPassword':     { en: 'New password',      it: 'Nuova password',      es: 'Nueva contraseña',  fr: 'Nouveau mot de passe',  de: 'Neues Passwort' },
  'account.labelConfirmPassword': { en: 'Confirm new password', it: 'Conferma nuova password', es: 'Confirma la nueva contraseña', fr: 'Confirmer le nouveau mot de passe', de: 'Neues Passwort bestätigen' },
  'account.passwordPlaceholder':  { en: 'At least 6 characters', it: 'Almeno 6 caratteri', es: 'Al menos 6 caracteres', fr: 'Au moins 6 caractères', de: 'Mindestens 6 Zeichen' },
  'account.updatePassword':       { en: 'Update password', it: 'Aggiorna password', es: 'Actualizar contraseña', fr: 'Mettre à jour le mot de passe', de: 'Passwort aktualisieren' },
  'account.updatingPassword':     { en: 'Updating…', it: 'Aggiornamento…', es: 'Actualizando…', fr: 'Mise à jour…', de: 'Wird aktualisiert…' },
  'account.passwordUpdated':      { en: 'Password updated.', it: 'Password aggiornata.', es: 'Contraseña actualizada.', fr: 'Mot de passe mis à jour.', de: 'Passwort aktualisiert.' },
  'account.passwordTooShort':     { en: 'New password must be at least 6 characters.', it: 'La nuova password deve avere almeno 6 caratteri.', es: 'La nueva contraseña debe tener al menos 6 caracteres.', fr: 'Le nouveau mot de passe doit comporter au moins 6 caractères.', de: 'Das neue Passwort muss mindestens 6 Zeichen lang sein.' },
  'account.passwordMismatch':     { en: 'New password and confirmation do not match.', it: 'La nuova password e la conferma non coincidono.', es: 'La nueva contraseña y la confirmación no coinciden.', fr: 'Le nouveau mot de passe et la confirmation ne correspondent pas.', de: 'Neues Passwort und Bestätigung stimmen nicht überein.' },
  'account.passwordChangeFailed': { en: 'Password change failed', it: 'Modifica password non riuscita', es: 'No se pudo cambiar la contraseña', fr: 'Échec de la modification du mot de passe', de: 'Passwortänderung fehlgeschlagen' },

  // Membership tab
  'account.leaveHQTitle':    { en: 'Leave the HQ team',  it: 'Lascia il team HQ',       es: 'Salir del equipo HQ',    fr: 'Quitter l\'équipe HQ',     de: 'HQ-Team verlassen' },
  'account.leaveSchoolTitle':{ en: 'Leave this school',  it: 'Lascia questa scuola',    es: 'Salir de esta escuela',  fr: 'Quitter cette école',      de: 'Diese Schule verlassen' },
  'account.leaveHQDesc': {
    en: "You'll lose access to the HQ panel. Your account stays registered if you have any other roles. If this is your only role, your account will be soft-deleted.",
    it: "Perderai l'accesso al pannello HQ. Il tuo account resta registrato se hai altri ruoli. Se è il tuo unico ruolo, verrà eliminato (soft delete).",
    es: 'Perderás el acceso al panel HQ. Tu cuenta se mantiene registrada si tienes otros roles. Si este es tu único rol, se eliminará de forma suave.',
    fr: "Vous perdrez l'accès au panneau HQ. Votre compte reste enregistré si vous avez d'autres rôles. S'il s'agit de votre seul rôle, votre compte sera supprimé (soft delete).",
    de: 'Du verlierst den Zugriff auf das HQ-Panel. Dein Konto bleibt registriert, wenn du andere Rollen hast. Ist dies deine einzige Rolle, wird dein Konto soft gelöscht.',
  },
  'account.leaveSchoolDesc': {
    en: "You'll lose access to this school. If you're the owner, transfer ownership first — otherwise no one can manage the school. If this is your only role, your account will be soft-deleted.",
    it: "Perderai l'accesso a questa scuola. Se sei il proprietario, trasferisci prima la proprietà — altrimenti nessuno potrà gestire la scuola. Se è il tuo unico ruolo, il tuo account verrà eliminato (soft delete).",
    es: 'Perderás el acceso a esta escuela. Si eres el propietario, transfiere primero la propiedad — si no, nadie podrá gestionar la escuela. Si este es tu único rol, tu cuenta se eliminará de forma suave.',
    fr: "Vous perdrez l'accès à cette école. Si vous êtes le propriétaire, transférez d'abord la propriété — sinon personne ne pourra gérer l'école. S'il s'agit de votre seul rôle, votre compte sera supprimé (soft delete).",
    de: 'Du verlierst den Zugriff auf diese Schule. Wenn du Eigentümer bist, übertrage zuerst den Besitz — sonst kann niemand die Schule verwalten. Ist dies deine einzige Rolle, wird dein Konto soft gelöscht.',
  },
  'account.ownerWarning': {
    en: 'You are the school owner. Leaving will leave the school without an admin.',
    it: 'Sei il proprietario della scuola. Andando via, la scuola resterà senza amministratore.',
    es: 'Eres el propietario de la escuela. Al salir, la escuela se quedará sin administrador.',
    fr: "Vous êtes le propriétaire de l'école. En partant, l'école se retrouvera sans administrateur.",
    de: 'Du bist der Besitzer der Schule. Beim Verlassen bleibt die Schule ohne Administrator.',
  },
  'account.leaveHQ':      { en: 'Leave HQ',     it: 'Lascia HQ',     es: 'Salir de HQ',       fr: 'Quitter HQ',        de: 'HQ verlassen' },
  'account.leaveSchool':  { en: 'Leave school', it: 'Lascia la scuola', es: 'Salir de la escuela', fr: "Quitter l'école", de: 'Schule verlassen' },
  'account.confirmLeaveHQ':     { en: 'Yes, leave HQ',     it: 'Sì, lascia HQ',     es: 'Sí, salir de HQ',       fr: 'Oui, quitter HQ',        de: 'Ja, HQ verlassen' },
  'account.confirmLeaveSchool': { en: 'Yes, leave school', it: 'Sì, lascia la scuola', es: 'Sí, salir de la escuela', fr: "Oui, quitter l'école", de: 'Ja, Schule verlassen' },
  'account.leaving':     { en: 'Leaving…', it: 'Uscita in corso…', es: 'Saliendo…', fr: 'En cours de départ…', de: 'Verlasse…' },
  'account.leaveFailed': { en: 'Leave failed', it: 'Uscita non riuscita', es: 'Error al salir', fr: 'Échec du départ', de: 'Verlassen fehlgeschlagen' },
  'account.cancel':      { en: 'Cancel', it: 'Annulla', es: 'Cancelar', fr: 'Annuler', de: 'Abbrechen' },

  // Delete account
  'account.deleteAccountTitle': { en: 'Delete my account', it: 'Elimina il mio account', es: 'Eliminar mi cuenta', fr: 'Supprimer mon compte', de: 'Mein Konto löschen' },
  'account.deleteAccount':      { en: 'Delete my account', it: 'Elimina il mio account', es: 'Eliminar mi cuenta', fr: 'Supprimer mon compte', de: 'Mein Konto löschen' },
  'account.deleteAccountDesc': {
    en: 'Permanently disables your login. You can reach out to support within 30 days if you change your mind.',
    it: 'Disattiva il tuo accesso in modo permanente. Puoi contattare il supporto entro 30 giorni se cambi idea.',
    es: 'Desactiva tu acceso de forma permanente. Puedes contactar con soporte en los próximos 30 días si cambias de opinión.',
    fr: "Désactive définitivement votre connexion. Vous pouvez contacter le support dans les 30 jours si vous changez d'avis.",
    de: 'Deaktiviert deinen Login dauerhaft. Du kannst dich innerhalb von 30 Tagen an den Support wenden, falls du es dir anders überlegst.',
  },
  'account.deleteConfirmPrompt': {
    en: 'Type "delete my account" to confirm:',
    it: 'Digita "delete my account" per confermare:',
    es: 'Escribe "delete my account" para confirmar:',
    fr: 'Saisissez "delete my account" pour confirmer :',
    de: 'Gib "delete my account" ein, um zu bestätigen:',
  },
  'account.deleteConfirmPhrase': {
    // Kept in English on purpose — it is also the string the API validates against
    en: 'delete my account', it: 'delete my account', es: 'delete my account', fr: 'delete my account', de: 'delete my account',
  },
  'account.permanentlyDelete': { en: 'Permanently delete', it: 'Elimina definitivamente', es: 'Eliminar permanentemente', fr: 'Supprimer définitivement', de: 'Endgültig löschen' },
  'account.deleting':          { en: 'Deleting…',          it: 'Eliminazione…',             es: 'Eliminando…',              fr: 'Suppression…',              de: 'Wird gelöscht…' },
  'account.deleteFailed':      { en: 'Delete failed',      it: 'Eliminazione non riuscita', es: 'Error al eliminar',        fr: 'Échec de la suppression',   de: 'Löschen fehlgeschlagen' },

  // ── Layout sidebar ────────────────────────────────────────────────
  'layout.myAccount': { en: 'My Account', it: 'Il mio account', es: 'Mi cuenta', fr: 'Mon compte', de: 'Mein Konto' },

  // ── Login error banners ───────────────────────────────────────────
  'auth.login.accountDeleted': {
    en: 'This account has been deleted. Contact support within 30 days to restore it.',
    it: 'Questo account è stato eliminato. Contatta il supporto entro 30 giorni per ripristinarlo.',
    es: 'Esta cuenta ha sido eliminada. Contacta con soporte en los próximos 30 días para restaurarla.',
    fr: 'Ce compte a été supprimé. Contactez le support dans les 30 jours pour le restaurer.',
    de: 'Dieses Konto wurde gelöscht. Kontaktiere den Support innerhalb von 30 Tagen, um es wiederherzustellen.',
  },
  'auth.login.resetExpired': {
    en: 'Your password reset link is invalid or has expired. Please request a new one.',
    it: 'Il link per il ripristino della password non è valido o è scaduto. Richiedine uno nuovo.',
    es: 'Tu enlace de restablecimiento de contraseña no es válido o ha caducado. Solicita uno nuevo.',
    fr: "Votre lien de réinitialisation du mot de passe n'est pas valide ou a expiré. Veuillez en demander un nouveau.",
    de: 'Dein Link zum Zurücksetzen des Passworts ist ungültig oder abgelaufen. Bitte fordere einen neuen an.',
  },
}

// Upsert each translation row (key,locale,value)
const rows = []
for (const [key, values] of Object.entries(translations)) {
  for (const locale of ['en', 'it', 'es', 'fr', 'de']) {
    rows.push({ key, locale, value: values[locale] })
  }
}

console.log(`Upserting ${rows.length} translation rows…\n`)

const { error } = await db
  .from('translations')
  .upsert(rows, { onConflict: 'key,locale' })

if (error) {
  console.error('❌ Error:', error.message)
  process.exit(1)
}

console.log(`✅  Filled ${Object.keys(translations).length} keys across 5 locales.`)
