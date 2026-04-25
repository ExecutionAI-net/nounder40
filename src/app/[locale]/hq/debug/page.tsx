import { getTranslations, getMessages } from 'next-intl/server'

export default async function DebugPage() {
  const messages = await getMessages()
  const t = await getTranslations('hq.dashboard')

  const hqMessages = (messages as Record<string, unknown>)?.hq

  return (
    <div style={{ padding: 20, fontFamily: 'monospace', fontSize: 12 }}>
      <h1>Translation Debug</h1>
      <p><strong>t(&apos;title&apos;):</strong> {t('title')}</p>
      <p><strong>t(&apos;newSchool&apos;):</strong> {t('newSchool')}</p>
      <hr />
      <h2>messages.hq keys:</h2>
      <pre>{JSON.stringify(hqMessages, null, 2)}</pre>
    </div>
  )
}
