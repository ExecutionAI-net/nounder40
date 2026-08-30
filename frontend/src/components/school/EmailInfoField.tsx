'use client'

// Box "Informazioni in email di conferma e reminder" — riusato in crea corso,
// modifica corso e modifica lezione. Etichette passate dal chiamante: ogni
// pagina ha il proprio namespace i18n (l'hint della singola lezione spiega
// l'ereditarietà dal corso, quello del corso la propagazione alle lezioni).
export default function EmailInfoField({ label, placeholder, hint, value, onChange }: {
  label: string
  placeholder: string
  hint: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="p-4 bg-[#6B1F3A]/5 border border-[#6B1F3A]/15 rounded-xl">
      <label className="block text-sm font-medium text-gray-700 mb-1">✉️ {label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={3}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1F3A]/20 resize-none bg-white"
      />
      <p className="text-xs text-gray-400 mt-1">{hint}</p>
    </div>
  )
}
