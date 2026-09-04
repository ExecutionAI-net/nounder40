'use client'

import { useTranslations } from 'next-intl'
import { Chip, Container, SectionHeading } from './primitives'

export default function LandingSteps() {
  const t = useTranslations('landing.steps')

  const steps = [
    { n: '01', title: t('s1Title'), body: t('s1Body'), tag: t('s1Tag') },
    { n: '02', title: t('s2Title'), body: t('s2Body'), tag: t('s2Tag') },
    { n: '03', title: t('s3Title'), body: t('s3Body'), tag: t('s3Tag') },
  ]

  return (
    <section className="bg-bv-surface py-20 lg:py-24">
      <Container>
        <SectionHeading kicker={t('kicker')} title={t('title')} lead={t('lead')} />
        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {steps.map(step => (
            <div key={step.n}
              className="flex flex-col rounded-[1.5rem] border border-bv-outline-variant/50 bg-bv-surface-low p-7">
              <span className="font-display text-5xl font-bold text-bv-blush">{step.n}</span>
              <h3 className="mt-4 font-display text-xl font-semibold text-bv-on-surface">
                {step.title}
              </h3>
              <p className="mt-3 flex-1 text-sm leading-6 text-bv-on-surface-variant">{step.body}</p>
              <div className="mt-6">
                <Chip tone="gold">{step.tag}</Chip>
              </div>
            </div>
          ))}
        </div>
      </Container>
    </section>
  )
}
