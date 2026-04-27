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

// ─── Translations ─────────────────────────────────────────────────────────────
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
      cta1: 'Get Started Free',
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
      subtitle: 'One platform, four powerful panels — each designed for its users',
      school: {
        title: 'Schools',
        desc: 'Everything you need to run a professional dance school.',
        items: ['Manage teachers & students', 'Schedule lessons & courses', 'Payments & subscriptions', 'Analytics & reports'],
      },
      teacher: {
        title: 'Teachers',
        desc: 'Focus on teaching. We handle the rest.',
        items: ['Personal lesson calendar', 'Mark attendance digitally', 'Track your compensation', 'Access Metodo Library'],
      },
      student: {
        title: 'Students',
        desc: 'Book, learn, and grow — from any device.',
        items: ['Book lessons online', 'Manage credits & packages', 'Video course library', 'Multi-school booking'],
      },
      hq: {
        title: 'HQ',
        desc: 'Full network visibility and control.',
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
      title: 'Start dancing in 3 steps',
      subtitle: 'Simple, fast, and designed for you',
      steps: [
        { n: '01', title: 'Create your account', desc: 'Register for free as a student. No credit card required.' },
        { n: '02', title: 'Find your school', desc: 'Browse schools in your city and discover the right lesson for you.' },
        { n: '03', title: 'Book your first class', desc: 'Purchase a package and reserve your spot in minutes.' },
      ],
    },
    cta: {
      student: { tag: 'For Students', title: 'Ready to dance?', desc: 'Join hundreds of students already on the platform.', btn: 'Register Now' },
      school: { tag: 'For Schools & Teachers', title: 'Join our network', desc: 'Bring your school to the next level with tools built for you.', btn: 'Contact Us' },
    },
    footer: { copy: '© 2026 Danza Classica No Under 40®. All rights reserved.', login: 'Login', privacy: 'Privacy Policy' },
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
      cta1: 'Inizia Gratis',
      cta2: 'Accedi',
    },
    stats: { teachers: 'Insegnanti', students: 'Studenti', lessons: 'Lezioni al Mese', schools: 'Scuole Attive' },
    features: {
      title: 'Pensato per ogni ruolo',
      subtitle: 'Una piattaforma, quattro pannelli potenti — ognuno progettato per i suoi utenti',
      school: {
        title: 'Scuole',
        desc: 'Tutto ciò di cui hai bisogno per gestire una scuola professionale.',
        items: ['Gestisci insegnanti e studenti', 'Pianifica lezioni e corsi', 'Pagamenti e abbonamenti', 'Analytics e report'],
      },
      teacher: {
        title: 'Insegnanti',
        desc: 'Concentrati sull\'insegnamento. Al resto pensiamo noi.',
        items: ['Calendario lezioni personale', 'Registra presenze digitalmente', 'Monitora il compenso', 'Accesso alla Metodo Library'],
      },
      student: {
        title: 'Studenti',
        desc: 'Prenota, impara e cresci — da qualsiasi dispositivo.',
        items: ['Prenota lezioni online', 'Gestisci crediti e pacchetti', 'Videocorsi in streaming', 'Prenotazione multi-scuola'],
      },
      hq: {
        title: 'HQ',
        desc: 'Visibilità e controllo totale della rete.',
        items: ["Gestisci l'intera rete", 'Configura le fee per scuola', 'Approva eventi speciali', 'Analytics di rete'],
      },
    },
    locations: { title: 'La Nostra Rete', subtitle: 'Scuole attive in tutta Europa', soon: 'Nuove città in arrivo', active: 'Attiva' },
    howItWorks: {
      title: 'Inizia a ballare in 3 passi',
      subtitle: 'Semplice, veloce e pensato per te',
      steps: [
        { n: '01', title: 'Crea il tuo account', desc: 'Registrati gratuitamente come studente. Nessuna carta di credito.' },
        { n: '02', title: 'Trova la tua scuola', desc: 'Esplora le scuole nella tua città e trova la lezione giusta per te.' },
        { n: '03', title: 'Prenota la prima lezione', desc: 'Acquista un pacchetto e riserva il tuo posto in pochi minuti.' },
      ],
    },
    cta: {
      student: { tag: 'Per Studenti', title: 'Pronta a ballare?', desc: 'Unisciti a centinaia di studenti già sulla piattaforma.', btn: 'Registrati Ora' },
      school: { tag: 'Per Scuole e Insegnanti', title: 'Entra nella nostra rete', desc: 'Porta la tua scuola al livello successivo.', btn: 'Contattaci' },
    },
    footer: { copy: '© 2026 Danza Classica No Under 40®. Tutti i diritti riservati.', login: 'Accedi', privacy: 'Privacy Policy' },
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
      cta1: 'Empezar Gratis',
      cta2: 'Iniciar sesión',
    },
    stats: { teachers: 'Profesores', students: 'Estudiantes', lessons: 'Clases al Mes', schools: 'Escuelas Activas' },
    features: {
      title: 'Diseñado para cada rol',
      subtitle: 'Una plataforma, cuatro paneles potentes — cada uno diseñado para sus usuarios',
      school: {
        title: 'Escuelas',
        desc: 'Todo lo que necesitas para gestionar una escuela profesional.',
        items: ['Gestiona profesores y estudiantes', 'Programa clases y cursos', 'Pagos y suscripciones', 'Análisis e informes'],
      },
      teacher: {
        title: 'Profesores',
        desc: 'Céntrate en enseñar. Nosotros nos encargamos del resto.',
        items: ['Calendario personal de clases', 'Registra asistencia digitalmente', 'Seguimiento de tu compensación', 'Acceso a la Metodo Library'],
      },
      student: {
        title: 'Estudiantes',
        desc: 'Reserva, aprende y crece — desde cualquier dispositivo.',
        items: ['Reserva clases online', 'Gestiona créditos y paquetes', 'Biblioteca de videocursos', 'Reserva en múltiples escuelas'],
      },
      hq: {
        title: 'HQ',
        desc: 'Visibilidad y control total de la red.',
        items: ['Gestiona toda la red', 'Configura tarifas por escuela', 'Aprueba eventos especiales', 'Análisis de toda la red'],
      },
    },
    locations: { title: 'Nuestra Red', subtitle: 'Escuelas activas en toda Europa', soon: 'Más ciudades próximamente', active: 'Activa' },
    howItWorks: {
      title: 'Empieza a bailar en 3 pasos',
      subtitle: 'Simple, rápido y diseñado para ti',
      steps: [
        { n: '01', title: 'Crea tu cuenta', desc: 'Regístrate gratis como estudiante. No se requiere tarjeta de crédito.' },
        { n: '02', title: 'Encuentra tu escuela', desc: 'Explora escuelas en tu ciudad y descubre la clase perfecta para ti.' },
        { n: '03', title: 'Reserva tu primera clase', desc: 'Compra un paquete y reserva tu lugar en minutos.' },
      ],
    },
    cta: {
      student: { tag: 'Para Estudiantes', title: '¿Lista para bailar?', desc: 'Únete a cientos de estudiantes que ya usan la plataforma.', btn: 'Registrarse Ahora' },
      school: { tag: 'Para Escuelas y Profesores', title: 'Únete a nuestra red', desc: 'Lleva tu escuela al siguiente nivel.', btn: 'Contáctanos' },
    },
    footer: { copy: '© 2026 Danza Classica No Under 40®. Todos los derechos reservados.', login: 'Iniciar sesión', privacy: 'Política de Privacidad' },
  },
}

const CITIES = [
  { name: 'Milano',    country: 'Italy',   flag: '🇮🇹', accent: '#1d4ed8' },
  { name: 'Barcelona', country: 'Spain',   flag: '🇪🇸', accent: '#6B1F3A' },
  { name: 'Rome',      country: 'Italy',   flag: '🇮🇹', accent: '#0369a1' },
]

const FEATURES = [
  { key: 'school',  icon: '🏫', accent: '#1d4ed8', lightBg: '#eff6ff', lightAccent: '#bfdbfe' },
  { key: 'teacher', icon: '👩‍🏫', accent: '#0369a1', lightBg: '#f0f9ff', lightAccent: '#bae6fd' },
  { key: 'student', icon: '🩰', accent: '#6B1F3A', lightBg: '#fdf2f8', lightAccent: '#f5d0e6' },
  { key: 'hq',      icon: '🏢', accent: '#0f172a', lightBg: '#f8fafc', lightAccent: '#cbd5e1' },
] as const

// ─── Count-up hook ─────────────────────────────────────────────────────────────
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

// ─── Component ─────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const [lang, setLang]       = useState<Lang>('en')
  const [stats, setStats]     = useState<Stats>({ teachers: 20, students: 249, lessonsMonthly: 950, schools: 3 })
  const [statsOn, setStatsOn] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const statsRef              = useRef<HTMLDivElement>(null)

  const t = T[lang]

  useEffect(() => {
    const l = navigator.language.toLowerCase()
    if (l.startsWith('it')) setLang('it')
    else if (l.startsWith('es')) setLang('es')
    else setLang('en')
  }, [])

  useEffect(() => {
    fetch('/api/platform-stats', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setStats(d))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setStatsOn(true) }, { threshold: 0.3 })
    if (statsRef.current) obs.observe(statsRef.current)
    return () => obs.disconnect()
  }, [])

  const cTeachers = useCountUp(stats.teachers,       1500, statsOn)
  const cStudents = useCountUp(stats.students,       2000, statsOn)
  const cLessons  = useCountUp(stats.lessonsMonthly, 2000, statsOn)
  const cSchools  = useCountUp(stats.schools,        1000, statsOn)

  return (
    <div style={{ background: '#fff', color: '#0f172a', fontFamily: "'Inter', system-ui, sans-serif" }}>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

        * { box-sizing: border-box; }

        @keyframes float-gentle {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-10px); }
        }
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(32px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.5; transform: scale(0.85); }
        }
        @keyframes shimmer {
          0%   { background-position: -200% center; }
          100% { background-position: 200% center; }
        }

        .anim-float   { animation: float-gentle 6s ease-in-out infinite; }
        .anim-fade-up { animation: fade-up 0.8s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .anim-fade-in { animation: fade-in 0.6s ease both; }

        .card-hover {
          transition: transform 0.25s ease, box-shadow 0.25s ease;
          cursor: default;
        }
        .card-hover:hover {
          transform: translateY(-4px);
          box-shadow: 0 20px 50px rgba(0,0,0,0.1);
        }

        .btn-primary-white {
          background: #0f172a;
          color: #fff;
          transition: background 0.2s, transform 0.15s;
        }
        .btn-primary-white:hover {
          background: #1e293b;
          transform: translateY(-1px);
        }

        .btn-outline-dark {
          border: 1.5px solid #e2e8f0;
          color: #334155;
          transition: border-color 0.2s, background 0.2s, transform 0.15s;
        }
        .btn-outline-dark:hover {
          border-color: #94a3b8;
          background: #f8fafc;
          transform: translateY(-1px);
        }

        .btn-burgundy {
          background: #6B1F3A;
          color: #fff;
          transition: background 0.2s, transform 0.15s, box-shadow 0.2s;
          box-shadow: 0 4px 20px rgba(107,31,58,0.25);
        }
        .btn-burgundy:hover {
          background: #5a1930;
          transform: translateY(-1px);
          box-shadow: 0 8px 28px rgba(107,31,58,0.35);
        }

        .nav-link {
          color: #475569;
          transition: color 0.15s;
          font-size: 14px;
          font-weight: 500;
        }
        .nav-link:hover { color: #0f172a; }

        .lang-btn {
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          transition: all 0.15s;
          cursor: pointer;
          border: none;
        }

        .feature-card {
          border: 1px solid #f1f5f9;
          border-radius: 16px;
          padding: 32px;
          background: #fff;
          transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease;
        }
        .feature-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 20px 50px rgba(0,0,0,0.07);
          border-color: #e2e8f0;
        }

        .step-card {
          display: flex;
          gap: 24px;
          align-items: flex-start;
          padding: 28px 32px;
          border-radius: 16px;
          border: 1px solid #f1f5f9;
          background: #fff;
          transition: box-shadow 0.25s, border-color 0.25s;
        }
        .step-card:hover {
          box-shadow: 0 12px 40px rgba(0,0,0,0.06);
          border-color: #e2e8f0;
        }

        .city-card {
          border-radius: 20px;
          padding: 36px 28px;
          text-align: center;
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .city-card:hover {
          transform: translateY(-6px);
          box-shadow: 0 24px 60px rgba(0,0,0,0.3);
        }

        .divider-line {
          width: 48px;
          height: 3px;
          border-radius: 2px;
          background: #6B1F3A;
          margin: 16px 0 24px;
        }

        .badge-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px;
          border-radius: 100px;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.03em;
        }

        .hero-image-wrapper {
          position: relative;
          border-radius: 24px;
          overflow: hidden;
          box-shadow: 0 40px 80px rgba(0,0,0,0.4);
        }

        .check-item {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          font-size: 14px;
          color: #475569;
          line-height: 1.5;
        }

        .section-label {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #6B1F3A;
        }

        .gradient-hero-text {
          background: linear-gradient(135deg, #ffffff 0%, #c7d8f0 60%, #93b8e0 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .stat-number {
          font-size: 56px;
          font-weight: 800;
          letter-spacing: -2px;
          line-height: 1;
          font-variant-numeric: tabular-nums;
        }

        @media (max-width: 768px) {
          .stat-number { font-size: 40px; }
          .hide-mobile { display: none !important; }
          .mobile-full { width: 100% !important; }
        }
      `}</style>

      {/* ── NAVBAR ─────────────────────────────────────────────────────────────── */}
      <nav style={{
        background: '#ffffff',
        borderBottom: '1px solid #f1f5f9',
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        boxShadow: '0 1px 20px rgba(0,0,0,0.06)',
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', height: 68, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>

          {/* Logo */}
          <Image src="/Logo.png" alt="No Under 40" width={120} height={42} style={{ objectFit: 'contain' }} priority />

          {/* Desktop nav */}
          <div className="hide-mobile" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Language toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: '#f8fafc', borderRadius: 8, padding: '3px', border: '1px solid #e2e8f0', marginRight: 16 }}>
              {(['en', 'it', 'es'] as Lang[]).map(l => (
                <button key={l} onClick={() => setLang(l)} className="lang-btn"
                  style={{
                    background: lang === l ? '#0f172a' : 'transparent',
                    color: lang === l ? '#fff' : '#94a3b8',
                  }}>
                  {l}
                </button>
              ))}
            </div>

            <Link href="/login" className="nav-link" style={{ padding: '8px 16px' }}>
              {t.nav.login}
            </Link>
            <Link href="/register" className="btn-burgundy"
              style={{ padding: '9px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600, textDecoration: 'none', display: 'inline-block' }}>
              {t.nav.register}
            </Link>
          </div>

          {/* Mobile menu button */}
          <button className="hide-desktop" onClick={() => setMenuOpen(!menuOpen)}
            style={{ background: 'none', border: 'none', padding: 8, cursor: 'pointer', display: 'none' }}
            aria-label="Menu">
            <div style={{ width: 22, height: 2, background: '#334155', marginBottom: 5, borderRadius: 2 }} />
            <div style={{ width: 22, height: 2, background: '#334155', marginBottom: 5, borderRadius: 2 }} />
            <div style={{ width: 22, height: 2, background: '#334155', borderRadius: 2 }} />
          </button>
        </div>
      </nav>

      {/* ── HERO ───────────────────────────────────────────────────────────────── */}
      <section style={{
        background: 'linear-gradient(160deg, #0a1628 0%, #0f1f3d 50%, #0d1730 100%)',
        paddingTop: 68,
        position: 'relative',
        overflow: 'hidden',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
      }}>

        {/* Background texture */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.025) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          pointerEvents: 'none',
        }} />
        {/* Ambient glows */}
        <div style={{ position: 'absolute', top: '15%', right: '5%', width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, rgba(29,78,216,0.08) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: '10%', left: '0%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(107,31,58,0.07) 0%, transparent 70%)', pointerEvents: 'none' }} />

        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '80px 24px', width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 64, alignItems: 'center' }}
          className="mobile-full" id="hero-grid">

          {/* Text */}
          <div className="anim-fade-up">
            <div className="badge-pill" style={{ background: 'rgba(107,31,58,0.2)', border: '1px solid rgba(107,31,58,0.35)', color: '#f0a0c0', marginBottom: 28 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#e06088', display: 'inline-block', animation: 'pulse-dot 2s ease-in-out infinite' }} />
              {t.hero.badge}
            </div>

            <h1 style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.05, marginBottom: 24, letterSpacing: '-2px' }}>
              <span className="gradient-hero-text" style={{ display: 'block' }}>{t.hero.title1}</span>
              <span style={{ color: '#fff', display: 'block' }}>{t.hero.title2}</span>
              <span style={{ color: 'rgba(255,255,255,0.28)', display: 'block' }}>{t.hero.title3}</span>
            </h1>

            <p style={{ fontSize: 18, color: '#7c9dc5', lineHeight: 1.7, marginBottom: 40, maxWidth: 460 }}>
              {t.hero.subtitle}
            </p>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Link href="/register" className="btn-burgundy"
                style={{ padding: '14px 32px', borderRadius: 12, fontSize: 15, fontWeight: 700, textDecoration: 'none', display: 'inline-block' }}>
                {t.hero.cta1}
              </Link>
              <Link href="/login"
                style={{ padding: '14px 32px', borderRadius: 12, fontSize: 15, fontWeight: 600, textDecoration: 'none', display: 'inline-block', border: '1.5px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)', transition: 'border-color 0.2s, color 0.2s, background 0.2s' }}
                onMouseEnter={e => { (e.target as HTMLElement).style.borderColor = 'rgba(255,255,255,0.35)'; (e.target as HTMLElement).style.color = '#fff' }}
                onMouseLeave={e => { (e.target as HTMLElement).style.borderColor = 'rgba(255,255,255,0.15)'; (e.target as HTMLElement).style.color = 'rgba(255,255,255,0.7)' }}>
                {t.hero.cta2}
              </Link>
            </div>

            {/* Trust row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 48, paddingTop: 32, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
              {[
                { icon: '✦', text: 'No age limit' },
                { icon: '✦', text: 'Multi-city network' },
                { icon: '✦', text: 'Free to join' },
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>
                  <span style={{ color: '#6B1F3A', fontSize: 8 }}>{item.icon}</span>
                  {item.text}
                </div>
              ))}
            </div>
          </div>

          {/* Photo */}
          <div className="anim-float hide-mobile" style={{ display: 'flex', justifyContent: 'center', animationDelay: '0.5s' }}>
            <div style={{ position: 'relative' }}>
              <div className="hero-image-wrapper">
                <Image src="/dancer.jpg" alt="Danza Classica No Under 40" width={540} height={420}
                  style={{ objectFit: 'cover', display: 'block' }} priority />
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 50%, rgba(10,22,40,0.7) 100%)' }} />
              </div>

              {/* Floating chip */}
              <div style={{
                position: 'absolute', bottom: -20, left: -24,
                background: '#fff',
                borderRadius: 16,
                padding: '14px 20px',
                boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
                minWidth: 200,
              }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 4, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Active Network</p>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>Milano · Barcelona · Rome</p>
              </div>

              {/* Decoration dots */}
              <div style={{ position: 'absolute', top: -16, right: -16, width: 80, height: 80, borderRadius: 12, backgroundImage: 'radial-gradient(rgba(107,31,58,0.4) 2px, transparent 2px)', backgroundSize: '12px 12px' }} />
            </div>
          </div>
        </div>

        {/* Bottom fade */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 100, background: 'linear-gradient(transparent, #fff)', pointerEvents: 'none' }} />
      </section>

      {/* ── STATS ──────────────────────────────────────────────────────────────── */}
      <section ref={statsRef} style={{ background: '#fff', paddingTop: 80, paddingBottom: 80 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
          <div style={{ textAlign: 'center', marginBottom: 60 }}>
            <p className="section-label">By the numbers</p>
            <div className="divider-line" style={{ margin: '12px auto 0' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, textAlign: 'center' }}>
            {[
              { val: cSchools,  suffix: '',  label: t.stats.schools },
              { val: cTeachers, suffix: '+', label: t.stats.teachers },
              { val: cStudents, suffix: '+', label: t.stats.students },
              { val: cLessons,  suffix: '+', label: t.stats.lessons },
            ].map((s, i) => (
              <div key={i} style={{ padding: '32px 16px', borderRadius: 16, background: i % 2 === 0 ? '#fafafa' : '#fff', border: '1px solid #f1f5f9' }}>
                <p className="stat-number" style={{ color: '#0f172a', margin: '0 0 8px', fontVariantNumeric: 'tabular-nums' }}>
                  {s.val.toLocaleString()}{s.suffix}
                </p>
                <p style={{ fontSize: 14, fontWeight: 500, color: '#64748b', margin: 0, letterSpacing: '0.02em' }}>{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ───────────────────────────────────────────────────────────── */}
      <section style={{ background: '#f8fafc', padding: '100px 0', borderTop: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px' }}>
          <div style={{ textAlign: 'center', marginBottom: 64 }}>
            <p className="section-label">Platform</p>
            <h2 style={{ fontSize: 42, fontWeight: 800, color: '#0f172a', margin: '12px 0 16px', letterSpacing: '-1px', lineHeight: 1.15 }}>
              {t.features.title}
            </h2>
            <p style={{ fontSize: 17, color: '#64748b', maxWidth: 540, margin: '0 auto', lineHeight: 1.6 }}>
              {t.features.subtitle}
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
            {FEATURES.map(({ key, icon, accent, lightBg }) => {
              const data = t.features[key]
              return (
                <div key={key} className="feature-card" style={{ background: '#fff' }}>
                  {/* Top accent bar */}
                  <div style={{ height: 4, borderRadius: '12px 12px 0 0', background: accent, margin: '-32px -32px 28px', width: 'calc(100% + 64px)' }} />

                  <div style={{ width: 48, height: 48, borderRadius: 12, background: lightBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, marginBottom: 20 }}>
                    {icon}
                  </div>

                  <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 8px', letterSpacing: '-0.3px' }}>
                    {data.title}
                  </h3>
                  <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 20px', lineHeight: 1.5 }}>
                    {data.desc}
                  </p>

                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {data.items.map((item, i) => (
                      <li key={i} className="check-item">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
                          <circle cx="8" cy="8" r="8" fill={accent} fillOpacity="0.12" />
                          <path d="M5 8l2 2 4-4" stroke={accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
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

      {/* ── LOCATIONS ──────────────────────────────────────────────────────────── */}
      <section style={{
        background: 'linear-gradient(160deg, #0a1628 0%, #0f1f3d 100%)',
        padding: '100px 0',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(255,255,255,0.02) 1px, transparent 1px)', backgroundSize: '32px 32px', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: '20%', left: '10%', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(29,78,216,0.06) 0%, transparent 70%)', pointerEvents: 'none' }} />

        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', position: 'relative' }}>
          <div style={{ textAlign: 'center', marginBottom: 64 }}>
            <p className="section-label" style={{ color: '#e06088' }}>Locations</p>
            <h2 style={{ fontSize: 42, fontWeight: 800, color: '#fff', margin: '12px 0 16px', letterSpacing: '-1px' }}>
              {t.locations.title}
            </h2>
            <p style={{ fontSize: 17, color: '#4a6fa5', maxWidth: 440, margin: '0 auto' }}>
              {t.locations.subtitle}
            </p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 24, flexWrap: 'wrap', alignItems: 'stretch' }}>
            {CITIES.map((city, i) => (
              <div key={city.name} className="city-card anim-float"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  minWidth: 200, flex: '1 1 200px', maxWidth: 260,
                  animationDelay: `${i * 0.4}s`,
                  backdropFilter: 'blur(8px)',
                }}>

                {/* City pin */}
                <div style={{ position: 'relative', width: 64, height: 64, margin: '0 auto 20px' }}>
                  <svg viewBox="0 0 64 64" style={{ width: '100%', height: '100%', filter: `drop-shadow(0 4px 16px ${city.accent}60)` }}>
                    <path d="M32 60 C32 60 12 40 12 26 C12 15.507 21.059 7 32 7 C42.941 7 52 15.507 52 26 C52 40 32 60 32 60Z"
                      fill={city.accent} />
                    <circle cx="32" cy="26" r="8" fill="white" fillOpacity="0.9" />
                  </svg>
                </div>

                <p style={{ fontSize: 26, fontWeight: 800, color: '#fff', margin: '0 0 6px', letterSpacing: '-0.5px' }}>{city.name}</p>
                <p style={{ fontSize: 14, color: '#4a6fa5', margin: '0 0 20px' }}>{city.flag} {city.country}</p>

                <span style={{
                  fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                  background: `${city.accent}22`, color: city.accent === '#0f172a' ? '#94a3b8' : city.accent,
                  border: `1px solid ${city.accent}40`,
                  borderColor: city.accent === '#0f172a' ? 'rgba(255,255,255,0.1)' : `${city.accent}40`,
                  padding: '5px 14px', borderRadius: 100,
                  display: 'inline-block',
                }}>
                  {t.locations.active}
                </span>
              </div>
            ))}

            {/* Coming soon */}
            <div className="city-card"
              style={{
                background: 'rgba(255,255,255,0.015)',
                border: '1px dashed rgba(255,255,255,0.08)',
                minWidth: 200, flex: '1 1 200px', maxWidth: 260,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, color: 'rgba(255,255,255,0.2)', marginBottom: 20 }}>
                +
              </div>
              <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.2)', fontWeight: 600, margin: '0 0 8px' }}>Coming soon</p>
              <p style={{ fontSize: 13, color: '#1e3a5f', margin: 0 }}>{t.locations.soon}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ───────────────────────────────────────────────────────── */}
      <section style={{ background: '#fff', padding: '100px 0' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 24px' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <p className="section-label">How it works</p>
            <h2 style={{ fontSize: 42, fontWeight: 800, color: '#0f172a', margin: '12px 0 16px', letterSpacing: '-1px', lineHeight: 1.15 }}>
              {t.howItWorks.title}
            </h2>
            <p style={{ fontSize: 17, color: '#64748b', lineHeight: 1.6 }}>{t.howItWorks.subtitle}</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'relative' }}>
            {/* Connector line */}
            <div style={{ position: 'absolute', left: 56, top: 28, bottom: 28, width: 1, background: 'linear-gradient(#f1f5f9 0%, #6B1F3A40 50%, #f1f5f9 100%)', zIndex: 0 }} />

            {t.howItWorks.steps.map((step, i) => (
              <div key={i} className="step-card" style={{ position: 'relative', zIndex: 1, background: '#fff' }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 14,
                  background: i === 1 ? '#6B1F3A' : '#f8fafc',
                  border: i === 1 ? 'none' : '1px solid #e2e8f0',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                  boxShadow: i === 1 ? '0 8px 24px rgba(107,31,58,0.3)' : 'none',
                }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: i === 1 ? '#fff' : '#94a3b8', letterSpacing: '0.05em' }}>
                    {step.n}
                  </span>
                </div>
                <div>
                  <h3 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: '0 0 6px', letterSpacing: '-0.3px' }}>
                    {step.title}
                  </h3>
                  <p style={{ fontSize: 14, color: '#64748b', margin: 0, lineHeight: 1.6 }}>{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────────────────── */}
      <section style={{ background: '#f8fafc', padding: '100px 0', borderTop: '1px solid #f1f5f9' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>

          {/* Student CTA */}
          <div style={{
            background: 'linear-gradient(145deg, #6B1F3A 0%, #8b2a4d 100%)',
            borderRadius: 24, padding: '52px 48px',
            position: 'relative', overflow: 'hidden',
          }}
            className="card-hover">
            <div style={{ position: 'absolute', top: -40, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
            <div style={{ position: 'absolute', bottom: -60, left: -20, width: 180, height: 180, borderRadius: '50%', background: 'rgba(0,0,0,0.1)' }} />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 16 }}>
              {t.cta.student.tag}
            </span>
            <h3 style={{ fontSize: 32, fontWeight: 800, color: '#fff', margin: '0 0 12px', letterSpacing: '-0.8px', lineHeight: 1.2 }}>
              {t.cta.student.title}
            </h3>
            <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.65)', margin: '0 0 36px', lineHeight: 1.6 }}>
              {t.cta.student.desc}
            </p>
            <Link href="/register"
              style={{ background: '#fff', color: '#6B1F3A', padding: '13px 28px', borderRadius: 12, fontSize: 14, fontWeight: 700, textDecoration: 'none', display: 'inline-block', transition: 'transform 0.15s, box-shadow 0.15s', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}
              onMouseEnter={e => { (e.target as HTMLElement).style.transform = 'translateY(-2px)'; (e.target as HTMLElement).style.boxShadow = '0 8px 30px rgba(0,0,0,0.25)' }}
              onMouseLeave={e => { (e.target as HTMLElement).style.transform = 'translateY(0)'; (e.target as HTMLElement).style.boxShadow = '0 4px 20px rgba(0,0,0,0.2)' }}>
              {t.cta.student.btn} →
            </Link>
          </div>

          {/* School CTA */}
          <div style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 24, padding: '52px 48px',
            position: 'relative', overflow: 'hidden',
          }}
            className="card-hover">
            <div style={{ position: 'absolute', top: 0, right: 0, width: 160, height: 160, background: 'radial-gradient(circle at 100% 0%, #f0f9ff 0%, transparent 70%)' }} />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6B1F3A', display: 'block', marginBottom: 16 }}>
              {t.cta.school.tag}
            </span>
            <h3 style={{ fontSize: 32, fontWeight: 800, color: '#0f172a', margin: '0 0 12px', letterSpacing: '-0.8px', lineHeight: 1.2 }}>
              {t.cta.school.title}
            </h3>
            <p style={{ fontSize: 15, color: '#64748b', margin: '0 0 36px', lineHeight: 1.6 }}>
              {t.cta.school.desc}
            </p>
            <a href="mailto:info@nounder40.com" className="btn-primary-white"
              style={{ padding: '13px 28px', borderRadius: 12, fontSize: 14, fontWeight: 700, textDecoration: 'none', display: 'inline-block' }}>
              {t.cta.school.btn} →
            </a>
          </div>
        </div>
      </section>

      {/* ── FOOTER ─────────────────────────────────────────────────────────────── */}
      <footer style={{ background: '#ffffff', borderTop: '1px solid #f1f5f9' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 24px', display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 20 }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Image src="/Logo.png" alt="No Under 40" width={100} height={36} style={{ objectFit: 'contain', opacity: 0.7 }} />
          </div>

          <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>{t.footer.copy}</p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <Link href="/login" style={{ fontSize: 13, color: '#94a3b8', textDecoration: 'none', transition: 'color 0.15s' }}
              onMouseEnter={e => (e.target as HTMLElement).style.color = '#334155'}
              onMouseLeave={e => (e.target as HTMLElement).style.color = '#94a3b8'}>
              {t.footer.login}
            </Link>
            <Link href="/register" className="btn-burgundy"
              style={{ padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none', display: 'inline-block' }}>
              {t.nav.register}
            </Link>
          </div>
        </div>
      </footer>

    </div>
  )
}
