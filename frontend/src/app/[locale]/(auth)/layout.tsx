import LanguageDropdown from '@/components/LanguageDropdown'

/**
 * Guscio delle pagine pubbliche di autenticazione — login, register,
 * reset-password, setup-account.
 *
 * I18N-R3-07: il selettore di lingua era montato solo nei quattro layout dei
 * pannelli, quindi chi non ha ancora un account non poteva cambiarla in alcun
 * modo se non riscrivendo il prefisso nell'URL. Il caso che conta davvero e'
 * l'invito: il link nella mail porta il locale della *scuola*
 * (`/it/setup-account?uid=...&token=...`), cosi' un'insegnante tedesca
 * invitata da una scuola italiana era costretta a creare l'account in
 * italiano.
 *
 * Sta qui e non nelle singole pagine di proposito: le quattro pagine sono
 * state raccolte nel gruppo `(auth)` (i gruppi non cambiano l'URL) perche' un
 * layout condiviso e' l'unico modo perche' la prossima pagina di
 * autenticazione nasca gia' con il selettore. Montarlo pagina per pagina e'
 * esattamente il modo in cui questo buco e' rimasto aperto.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* fixed: le quattro pagine hanno guscio proprio (AuthSplit, card
          centrata) e nessun punto in comune dove ancorare il controllo. */}
      <div className="fixed right-4 top-4 z-50 sm:right-6 sm:top-6">
        <LanguageDropdown />
      </div>
      {children}
    </>
  )
}
