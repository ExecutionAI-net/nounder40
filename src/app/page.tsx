'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'

type Lang = 'en' | 'it' | 'es'

interface Stats {
  teachers: number
  students: number
  lessonsMonthly: number
  schools: number
}

// ─── Translations ────────────────────────────────────────────────────────────
const T = {
  en: {
    nav: { login: 'Login', register: 'Register', registerSub: 'Students only' },
    hero: {
      badge: 'The Platform for Adult Ballet',
      title1: 'Classical Dance.',
      title2: 'No Limits.',
      title3: 'No Age.',
      subtitle:
        'The first platform dedicated to adult classical dance schools. Manage lessons, book classes, and grow your network — all in one place.',
      cta1: 'Get Started',
      cta2: 'Login',
    },
    stats: {
      teachers: 'Teachers',
      students: 'Students',
      lessons: 'Monthly Lessons',
      schools: 'Active Schools',
    },
    features: {
      title: 'Built for every role',
      subtitle: 'One platform, four powerful panels',
      school: {
        title: 'Schools',
        items: ['Manage teachers & students', 'Schedule lessons & courses', 'Payments & subscriptions', 'Analytics & reports'],
      },
      teacher: {
        title: 'Teachers',
        items: ['Personal lesson calendar', 'Mark attendance digitally', 'Track your compensation', 'Access Metodo Library'],
      },
      student: {
        title: 'Students',
        items: ['Book lessons online', 'Manage credits & packages', 'Video course library', 'Multi-school booking'],
      },
      hq: {
        title: 'HQ',
        items: ['Manage the entire network', 'Set platform fees per school', 'Approve special events', 'Network-wide analytics'],
      },
    },
    locations: {
      title: 'Our Network',
      subtitle: 'Active schools across Europe',
      soon: 'More cities coming soon',
      active: 'Active',
    },
    howItWorks: {
      title: 'How it works',
      subtitle: 'Start dancing in 3 simple steps',
      steps: [
        { n: '01', title: 'Create your account', desc: 'Register for free as a student. No credit card required.' },
        { n: '02', title: 'Find your school', desc: 'Browse schools in your city and discover the right lesson for you.' },
        { n: '03', title: 'Book your first class', desc: 'Purchase a package and reserve your spot in minutes.' },
      ],
    },
    cta: {
      student: { tag: 'For Students', title: 'Ready to dance?', desc: 'Join hundreds of students already on the platform.', btn: 'Register Now' },
      school: { tag: 'For Schools & Teachers', title: 'Join our network', desc: 'Bring your school to the next level with the tools built for you.', btn: 'Contact Us' },
    },
    footer: { copy: '© 2026 Danza Classica No Under 40®. All rights reserved.', login: 'Login' },
  },
  it: {
    nav: { login: 'Accedi', register: 'Registrati', registerSub: 'Solo studenti' },
    hero: {
      badge: 'La Piattaforma per la Danza Adulta',
      title1: 'Danza Classica.',
      title2: 'Nessun Limite.',
      title3: 'Nessuna Età.',
      subtitle:
        'La prima piattaforma dedicata alle scuole di danza classica per adulti. Gestisci lezioni, prenota corsi e fai crescere la tua rete — tutto in un unico posto.',
      cta1: 'Inizia Ora',
      cta2: 'Accedi',
    },
    stats: { teachers: 'Insegnanti', students: 'Studenti', lessons: 'Lezioni al Mese', schools: 'Scuole Attive' },
    features: {
      title: 'Pensato per ogni ruolo',
      subtitle: 'Una piattaforma, quattro pannelli potenti',
      school: {
        title: 'Scuole',
        items: ['Gestisci insegnanti e studenti', 'Pianifica lezioni e corsi', 'Pagamenti e abbonamenti', 'Analytics e report'],
      },
      teacher: {
        title: 'Insegnanti',
        items: ['Calendario lezioni personale', 'Registra presenze digitalmente', 'Monitora il compenso', 'Accesso alla Metodo Library'],
      },
      student: {
        title: 'Studenti',
        items: ['Prenota lezioni online', 'Gestisci crediti e pacchetti', 'Videocorsi in streaming', 'Prenotazione multi-scuola'],
      },
      hq: {
        title: 'HQ',
        items: ["Gestisci l'intera rete", 'Configura le fee per scuola', 'Approva eventi speciali', 'Analytics di rete'],
      },
    },
    locations: { title: 'La Nostra Rete', subtitle: 'Scuole attive in tutta Europa', soon: 'Nuove città in arrivo', active: 'Attiva' },
    howItWorks: {
      title: 'Come funziona',
      subtitle: 'Inizia a ballare in 3 semplici passi',
      steps: [
        { n: '01', title: 'Crea il tuo account', desc: 'Registrati gratuitamente come studente. Nessuna carta di credito.' },
        { n: '02', title: 'Trova la tua scuola', desc: 'Esplora le scuole nella tua città e trova la lezione giusta per te.' },
        { n: '03', title: 'Prenota la prima lezione', desc: 'Acquista un pacchetto e riserva il tuo posto in pochi minuti.' },
      ],
    },
    cta: {
      student: { tag: 'Per Studenti', title: 'Pronta a ballare?', desc: 'Unisciti a centinaia di studenti già sulla piattaforma.', btn: 'Registrati Ora' },
      school: { tag: 'Per Scuole e Insegnanti', title: 'Entra nella nostra rete', desc: 'Porta la tua scuola al livello successivo con gli strumenti giusti.', btn: 'Contattaci' },
    },
    footer: { copy: '© 2026 Danza Classica No Under 40®. Tutti i diritti riservati.', login: 'Accedi' },
  },
  es: {
    nav: { login: 'Iniciar sesión', register: 'Registrarse', registerSub: 'Solo estudiantes' },
    hero: {
      badge: 'La Plataforma para la Danza Adulta',
      title1: 'Danza Clásica.',
      title2: 'Sin Límites.',
      title3: 'Sin Edad.',
      subtitle:
        'La primera plataforma dedicada a las escuelas de danza clásica para adultos. Gestiona clases, reserva cursos y haz crecer tu red — todo en un solo lugar.',
      cta1: 'Empezar Ahora',
      cta2: 'Iniciar sesión',
    },
    stats: { teachers: 'Profesores', students: 'Estudiantes', lessons: 'Clases al Mes', schools: 'Escuelas Activas' },
    features: {
      title: 'Diseñado para cada rol',
      subtitle: 'Una plataforma, cuatro paneles potentes',
      school: {
        title: 'Escuelas',
        items: ['Gestiona profesores y estudiantes', 'Programa clases y cursos', 'Pagos y suscripciones', 'Análisis e informes'],
      },
      teacher: {
        title: 'Profesores',
        items: ['Calendario personal de clases', 'Registra asistencia digitalmente', 'Seguimiento de tu compensación', 'Acceso a la Metodo Library'],
      },
      student: {
        title: 'Estudiantes',
        items: ['Reserva clases online', 'Gestiona créditos y paquetes', 'Biblioteca de videocursos', 'Reserva en múltiples escuelas'],
      },
      hq: {
        title: 'HQ',
        items: ['Gestiona toda la red', 'Configura tarifas por escuela', 'Aprueba eventos especiales', 'Análisis de toda la red'],
      },
    },
    locations: { title: 'Nuestra Red', subtitle: 'Escuelas activas en toda Europa', soon: 'Más ciudades próximamente', active: 'Activa' },
    howItWorks: {
      title: 'Cómo funciona',
      subtitle: 'Empieza a bailar en 3 pasos sencillos',
      steps: [
        { n: '01', title: 'Crea tu cuenta', desc: 'Regístrate gratis como estudiante. No se requiere tarjeta de crédito.' },
        { n: '02', title: 'Encuentra tu escuela', desc: 'Explora escuelas en tu ciudad y descubre la clase perfecta para ti.' },
        { n: '03', title: 'Reserva tu primera clase', desc: 'Compra un paquete y reserva tu lugar en minutos.' },
      ],
    },
    cta: {
      student: { tag: 'Para Estudiantes', title: '¿Lista para bailar?', desc: 'Únete a cientos de estudiantes que ya usan la plataforma.', btn: 'Registrarse Ahora' },
      school: { tag: 'Para Escuelas y Profesores', title: 'Únete a nuestra red', desc: 'Lleva tu escuela al siguiente nivel con las herramientas adecuadas.', btn: 'Contáctanos' },
    },
    footer: { copy: '© 2026 Danza Classica No Under 40®. Todos los derechos reservados.', login: 'Iniciar sesión' },
  },
}

const CITIES = [
  { name: 'Milano',    country: 'Italy',  flag: '🇮🇹', color: '#4a90d9', delay: '0s' },
  { name: 'Barcelona', country: 'Spain',  flag: '🇪🇸', color: '#e84560', delay: '0.6s' },
  { name: 'Rome',      country: 'Italy',  flag: '🇮🇹', color: '#c9a84c', delay: '1.2s' },
]

const FEATURES = [
  { key: 'school',  icon: '🏫', color: '#4a90d9' },
  { key: 'teacher', icon: '👩‍🏫', color: '#c9a84c' },
  { key: 'student', icon: '🩰', color: '#a855f7' },
  { key: 'hq',      icon: '🏢', color: '#34d399' },
] as const

// ─── Count-up hook ────────────────────────────────────────────────────────────
function useCountUp(target: number, duration = 2000, active = false) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!active) return
    let start: number
    const raf = (ts: number) => {
      if (!start) start = ts
      const p = Math.min((ts - start) / duration, 1)
      setCount(Math.floor((1 - Math.pow(1 - p, 3)) * target))
      if (p < 1) requestAnimationFrame(raf)
    }
    requestAnimationFrame(raf)
  }, [target, duration, active])
  return count
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const [lang, setLang]       = useState<Lang>('en')
  const [stats, setStats]     = useState<Stats>({ teachers: 20, students: 249, lessonsMonthly: 950, schools: 3 })
  const [statsOn, setStatsOn] = useState(false)
  const statsRef              = useRef<HTMLDivElement>(null)

  const t = T[lang]

  // Detect browser language
  useEffect(() => {
    const l = navigator.language.toLowerCase()
    if (l.startsWith('it')) setLang('it')
    else if (l.startsWith('es')) setLang('es')
    else setLang('en')
  }, [])

  // Fetch live stats
  useEffect(() => {
    fetch('/api/platform-stats')
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setStats(d))
      .catch(() => {})
  }, [])

  // Trigger count-up on scroll
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setStatsOn(true) }, { threshold: 0.4 })
    if (statsRef.current) obs.observe(statsRef.current)
    return () => obs.disconnect()
  }, [])

  const cTeachers = useCountUp(stats.teachers,       1500, statsOn)
  const cStudents = useCountUp(stats.students,       2000, statsOn)
  const cLessons  = useCountUp(stats.lessonsMonthly, 2000, statsOn)
  const cSchools  = useCountUp(stats.schools,        1000, statsOn)

  return (
    <div style={{ background: '#0a1628', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>

      {/* ── Animations ─────────────────────────────────────────────────────── */}
      <style>{`
        @keyframes pulse-ring {
          0%, 100% { transform: scale(1); opacity: 0.4; }
          50%       { transform: scale(1.6); opacity: 0; }
        }
        @keyframes float-y {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-12px); }
        }
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-float   { animation: float-y 5s ease-in-out infinite; }
        .animate-fade-up { animation: fade-in-up 0.7s ease both; }
        .card-lift { transition: transform 0.3s ease, box-shadow 0.3s ease; }
        .card-lift:hover { transform: translateY(-6px); box-shadow: 0 24px 60px rgba(0,0,0,0.4); }
        .glass {
          background: rgba(255,255,255,0.04);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255,255,255,0.09);
        }
        .gradient-text {
          background: linear-gradient(135deg, #fff 0%, #a8c8f0 55%, #4a90d9 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .btn-primary {
          background: linear-gradient(135deg, #6B1F3A, #8b2a4d);
          box-shadow: 0 8px 30px rgba(107,31,58,0.4);
          transition: opacity 0.2s, transform 0.2s;
        }
        .btn-primary:hover { opacity: 0.9; transform: translateY(-1px); }
        .btn-ghost {
          border: 1px solid rgba(255,255,255,0.18);
          transition: background 0.2s, transform 0.2s;
        }
        .btn-ghost:hover { background: rgba(255,255,255,0.08); transform: translateY(-1px); }
        .dot-grid {
          background-image: radial-gradient(rgba(74,144,217,0.14) 1px, transparent 1px);
          background-size: 30px 30px;
        }
        .pin-pulse::before {
          content: '';
          position: absolute;
          inset: -8px;
          border-radius: 50%;
          background: var(--pin-color, #4a90d9);
          animation: pulse-ring 2.5s ease-out infinite;
        }
      `}</style>

      {/* ── NAVBAR ──────────────────────────────────────────────────────────── */}
      <nav style={{ background: 'rgba(10,22,40,0.92)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        className="fixed top-0 left-0 right-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Image src="/Logo.png" alt="No Under 40" width={130} height={46}
            style={{ filter: 'invert(1)', objectFit: 'contain' }} />

          <div className="flex items-center gap-5">
            {/* Language toggle */}
            <div className="flex items-center gap-0.5 text-xs rounded-full px-1.5 py-1"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}>
              {(['en', 'it', 'es'] as Lang[]).map(l => (
                <button key={l} onClick={() => setLang(l)}
                  className="px-2.5 py-1 rounded-full uppercase font-semibold tracking-wide transition-all"
                  style={{ background: lang === l ? '#4a90d9' : 'transparent', color: lang === l ? '#fff' : '#64748b' }}>
                  {l}
                </button>
              ))}
            </div>

            <Link href="/login" className="text-sm font-medium transition-colors" style={{ color: '#94a3b8' }}>
              {t.nav.login}
            </Link>
            <Link href="/register" className="btn-primary text-sm font-semibold px-5 py-2.5 rounded-xl text-white">
              {t.nav.register}
              <span className="ml-1.5 text-xs opacity-60">— {t.nav.registerSub}</span>
            </Link>
          </div>
        </div>
      </nav>

      {/* ── HERO ────────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center" style={{ paddingTop: 80 }}>
        {/* Radial glow background */}
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 70% 60% at 65% 50%, rgba(74,144,217,0.07) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: '10%', left: '5%', width: 400, height: 400, borderRadius: '50%', background: 'rgba(107,31,58,0.04)', filter: 'blur(80px)', pointerEvents: 'none' }} />

        <div className="max-w-7xl mx-auto px-6 w-full grid grid-cols-1 lg:grid-cols-2 gap-16 items-center py-24">
          {/* Text */}
          <div className="animate-fade-up">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold mb-8"
              style={{ background: 'rgba(74,144,217,0.1)', border: '1px solid rgba(74,144,217,0.2)', color: '#4a90d9' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4a90d9', display: 'inline-block', boxShadow: '0 0 8px #4a90d9' }} />
              {t.hero.badge}
            </div>

            <h1 style={{ lineHeight: 1.1 }} className="text-5xl lg:text-7xl font-bold mb-6">
              <span className="gradient-text">{t.hero.title1}</span><br />
              <span style={{ color: '#fff' }}>{t.hero.title2}</span><br />
              <span style={{ color: 'rgba(255,255,255,0.35)' }}>{t.hero.title3}</span>
            </h1>

            <p className="text-lg mb-10 leading-relaxed" style={{ color: '#94a3b8', maxWidth: 480 }}>
              {t.hero.subtitle}
            </p>

            <div className="flex gap-4 flex-wrap">
              <Link href="/register" className="btn-primary px-9 py-4 rounded-xl text-sm font-bold text-white">
                {t.hero.cta1}
              </Link>
              <Link href="/login" className="btn-ghost px-9 py-4 rounded-xl text-sm font-bold text-white">
                {t.hero.cta2}
              </Link>
            </div>
          </div>

          {/* Photo */}
          <div className="relative flex justify-center animate-float" style={{ animationDelay: '0.3s' }}>
            <div style={{ position: 'relative', borderRadius: 28, overflow: 'hidden', boxShadow: '0 40px 100px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)' }}>
              <Image src="/dancer.jpg" alt="Danza Classica No Under 40" width={580} height={430}
                style={{ objectFit: 'cover', display: 'block' }} priority />
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 55%, rgba(10,22,40,0.85) 100%)' }} />
            </div>
            {/* Floating stat chip */}
            <div className="glass absolute -bottom-5 -left-5 px-5 py-3 rounded-2xl"
              style={{ boxShadow: '0 12px 40px rgba(0,0,0,0.4)' }}>
              <p className="text-xs mb-0.5" style={{ color: '#64748b' }}>Active Network</p>
              <p className="font-bold text-white text-sm">Milano · Barcelona · Rome</p>
            </div>
          </div>
        </div>

        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 120, background: 'linear-gradient(transparent, #0a1628)', pointerEvents: 'none' }} />
      </section>

      {/* ── STATS ───────────────────────────────────────────────────────────── */}
      <section ref={statsRef} style={{ background: '#0d1a30', borderTop: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="max-w-7xl mx-auto px-6 py-16">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-10 text-center">
            {[
              { val: cSchools,  suffix: '',  label: t.stats.schools },
              { val: cTeachers, suffix: '+', label: t.stats.teachers },
              { val: cStudents, suffix: '+', label: t.stats.students },
              { val: cLessons,  suffix: '+', label: t.stats.lessons },
            ].map((s, i) => (
              <div key={i}>
                <p className="text-5xl lg:text-6xl font-bold mb-1.5 gradient-text" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {s.val}{s.suffix}
                </p>
                <p className="text-sm font-medium tracking-wide" style={{ color: '#475569' }}>{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ────────────────────────────────────────────────────────── */}
      <section style={{ background: '#0a1628' }} className="py-28">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl lg:text-5xl font-bold mb-3 gradient-text">{t.features.title}</h2>
            <p style={{ color: '#475569' }}>{t.features.subtitle}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {FEATURES.map(({ key, icon, color }) => {
              const data = t.features[key]
              return (
                <div key={key} className="card-lift rounded-2xl p-7"
                  style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${color}18` }}>
                  <div className="text-4xl mb-5">{icon}</div>
                  <h3 className="font-bold text-lg mb-4" style={{ color }}>{data.title}</h3>
                  <ul className="space-y-2.5">
                    {data.items.map((item, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm leading-snug" style={{ color: '#94a3b8' }}>
                        <span style={{ color, marginTop: 1, flexShrink: 0 }}>✓</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── LOCATIONS ───────────────────────────────────────────────────────── */}
      <section className="dot-grid py-28 relative overflow-hidden"
        style={{ background: '#0d1a30', borderTop: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>

        {/* Atmospheric glows */}
        <div style={{ position: 'absolute', top: '15%', left: '15%', width: 350, height: 350, borderRadius: '50%', background: 'rgba(74,144,217,0.04)', filter: 'blur(70px)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: '10%', right: '15%', width: 350, height: 350, borderRadius: '50%', background: 'rgba(107,31,58,0.04)', filter: 'blur(70px)', pointerEvents: 'none' }} />

        <div className="max-w-7xl mx-auto px-6 relative">
          <div className="text-center mb-16">
            <h2 className="text-4xl lg:text-5xl font-bold mb-3 gradient-text">{t.locations.title}</h2>
            <p style={{ color: '#475569' }}>{t.locations.subtitle}</p>
          </div>

          <div className="flex flex-wrap justify-center gap-8 items-stretch">
            {CITIES.map((city, i) => (
              <div key={city.name} className="card-lift rounded-3xl p-10 text-center flex flex-col items-center"
                style={{
                  background: `linear-gradient(145deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))`,
                  border: `1px solid ${city.color}28`,
                  boxShadow: `0 0 60px ${city.color}08`,
                  minWidth: 220,
                  animation: `float-y ${4 + i * 0.5}s ease-in-out infinite`,
                  animationDelay: city.delay,
                }}>

                {/* Animated pin */}
                <div style={{ position: 'relative', width: 56, height: 56, marginBottom: 24 }}>
                  <div className="pin-pulse" style={{
                    position: 'absolute', inset: 12, borderRadius: '50%',
                    background: city.color,
                    ['--pin-color' as string]: city.color,
                    zIndex: 1
                  }} />
                  <svg viewBox="0 0 56 56" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                    <path d="M28 52 C28 52 10 34 10 23 C10 13.059 18.059 5 28 5 C37.941 5 46 13.059 46 23 C46 34 28 52 28 52Z"
                      fill={city.color} opacity="0.9" />
                    <circle cx="28" cy="23" r="7" fill="white" fillOpacity="0.95" />
                  </svg>
                </div>

                <p className="text-3xl font-bold mb-1" style={{ color: '#fff', letterSpacing: '-0.5px' }}>{city.name}</p>
                <p className="text-sm mb-5" style={{ color: '#64748b' }}>{city.flag} {city.country}</p>
                <span className="text-xs px-3.5 py-1.5 rounded-full font-semibold"
                  style={{ background: `${city.color}18`, color: city.color, border: `1px solid ${city.color}35` }}>
                  {t.locations.active}
                </span>
              </div>
            ))}

            {/* Coming soon card */}
            <div className="rounded-3xl p-10 text-center flex flex-col items-center justify-center"
              style={{ minWidth: 220, background: 'rgba(255,255,255,0.015)', border: '1px dashed rgba(255,255,255,0.1)' }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24, fontSize: 24 }}>
                +
              </div>
              <p className="text-xl font-bold mb-2" style={{ color: 'rgba(255,255,255,0.25)' }}>...</p>
              <p className="text-sm" style={{ color: '#334155' }}>{t.locations.soon}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ────────────────────────────────────────────────────── */}
      <section style={{ background: '#0a1628' }} className="py-28">
        <div className="max-w-3xl mx-auto px-6">
          <div className="text-center mb-14">
            <h2 className="text-4xl lg:text-5xl font-bold mb-3 gradient-text">{t.howItWorks.title}</h2>
            <p style={{ color: '#475569' }}>{t.howItWorks.subtitle}</p>
          </div>
          <div className="space-y-5">
            {t.howItWorks.steps.map((step, i) => (
              <div key={i} className="card-lift flex gap-7 items-start rounded-2xl p-7"
                style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: 52, fontWeight: 800, color: 'rgba(74,144,217,0.12)', lineHeight: 1, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                  {step.n}
                </span>
                <div>
                  <h3 className="text-xl font-bold mb-1.5" style={{ color: '#fff' }}>{step.title}</h3>
                  <p style={{ color: '#64748b' }}>{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────────────── */}
      <section style={{ background: '#0d1a30', borderTop: '1px solid rgba(255,255,255,0.05)' }} className="py-28">
        <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 md:grid-cols-2 gap-7">

          {/* Student */}
          <div className="rounded-3xl p-12 relative overflow-hidden card-lift"
            style={{ background: 'linear-gradient(145deg, #160a0f, #2a1120)', border: '1px solid rgba(107,31,58,0.25)' }}>
            <div style={{ position: 'absolute', top: -60, right: -60, width: 220, height: 220, borderRadius: '50%', background: 'rgba(107,31,58,0.12)', filter: 'blur(50px)' }} />
            <span className="text-xs font-semibold px-3 py-1.5 rounded-full inline-block mb-5"
              style={{ background: 'rgba(107,31,58,0.2)', color: '#e07090', border: '1px solid rgba(107,31,58,0.3)' }}>
              {t.cta.student.tag}
            </span>
            <h3 className="text-3xl font-bold mb-3" style={{ color: '#fff' }}>{t.cta.student.title}</h3>
            <p className="mb-8 leading-relaxed" style={{ color: '#94a3b8' }}>{t.cta.student.desc}</p>
            <Link href="/register" className="btn-primary inline-block px-9 py-4 rounded-xl text-sm font-bold text-white">
              {t.cta.student.btn}
            </Link>
          </div>

          {/* School */}
          <div className="rounded-3xl p-12 relative overflow-hidden card-lift"
            style={{ background: 'linear-gradient(145deg, #0a1421, #132035)', border: '1px solid rgba(74,144,217,0.18)' }}>
            <div style={{ position: 'absolute', top: -60, right: -60, width: 220, height: 220, borderRadius: '50%', background: 'rgba(74,144,217,0.07)', filter: 'blur(50px)' }} />
            <span className="text-xs font-semibold px-3 py-1.5 rounded-full inline-block mb-5"
              style={{ background: 'rgba(74,144,217,0.1)', color: '#4a90d9', border: '1px solid rgba(74,144,217,0.2)' }}>
              {t.cta.school.tag}
            </span>
            <h3 className="text-3xl font-bold mb-3" style={{ color: '#fff' }}>{t.cta.school.title}</h3>
            <p className="mb-8 leading-relaxed" style={{ color: '#94a3b8' }}>{t.cta.school.desc}</p>
            <a href="mailto:info@nounder40.com" className="btn-ghost inline-block px-9 py-4 rounded-xl text-sm font-bold"
              style={{ color: '#4a90d9' }}>
              {t.cta.school.btn}
            </a>
          </div>
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────────────────── */}
      <footer style={{ background: '#060d1a', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Image src="/Logo.png" alt="No Under 40" width={100} height={36}
              style={{ filter: 'invert(1)', opacity: 0.45, objectFit: 'contain' }} />
            <p className="text-xs" style={{ color: '#1e3a5f' }}>{t.footer.copy}</p>
          </div>
          <Link href="/login" className="text-sm transition-colors" style={{ color: '#334155' }}>
            {t.footer.login}
          </Link>
        </div>
      </footer>

    </div>
  )
}
