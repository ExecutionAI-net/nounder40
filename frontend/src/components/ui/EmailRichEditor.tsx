'use client'

/**
 * EmailRichEditor — editor visuale per i template email (HQ).
 * Basato su Lexical (stesso approccio dell'editor documenti di Svolgo CRM):
 * HTML in ingresso → nodi Lexical; a ogni modifica → HTML in uscita.
 * Toolbar: B/I/U, font, grandezza, elenchi, link, immagine (upload), annulla.
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $generateNodesFromDOM, $generateHtmlFromNodes } from '@lexical/html'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode, INSERT_UNORDERED_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND } from '@lexical/list'
import { LinkNode, AutoLinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link'
import { $patchStyleText } from '@lexical/selection'
import {
  $createParagraphNode, $getRoot, $getSelection, $isRangeSelection,
  $isElementNode, $isDecoratorNode, $insertNodes, $getNodeByKey,
  FORMAT_TEXT_COMMAND, FORMAT_ELEMENT_COMMAND, UNDO_COMMAND, REDO_COMMAND,
  DecoratorNode,
  type DOMConversionMap, type DOMConversionOutput, type DOMExportOutput,
  type EditorConfig, type LexicalEditor, type NodeKey,
  type SerializedLexicalNode, type Spread,
} from 'lexical'
import type { JSX } from 'react'

// ═══ Icone allineamento (SVG, coerenti a qualsiasi zoom) ═══

function AlignIcon({ kind }: { kind: 'left' | 'center' | 'right' }) {
  const rows: [number, number][] = kind === 'left'
    ? [[1, 12], [1, 8], [1, 12], [1, 8]]
    : kind === 'center'
      ? [[1, 12], [3, 8], [1, 12], [3, 8]]
      : [[1, 12], [5, 8], [1, 12], [5, 8]]
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      {rows.map(([x, w], i) => (
        <rect key={i} x={x} y={1.5 + i * 3.2} width={w} height="1.6" rx="0.8" fill="currentColor" />
      ))}
    </svg>
  )
}

type Align = 'left' | 'center' | 'right'

// ═══ ImageNode — nodo immagine ridimensionabile e allineabile (import/export <img>) ═══

// larghezza in percentuale della colonna email (null = 100%)
type SerializedImageNode = Spread<{ src: string; alt: string; widthPct: number | null; align: Align }, SerializedLexicalNode>

// Immagine cliccabile: selezionandola compaiono i controlli di grandezza
function ImageComponent({ src, alt, widthPct, align, nodeKey }: { src: string; alt: string; widthPct: number | null; align: Align; nodeKey: NodeKey }) {
  const [editor] = useLexicalComposerContext()
  const [selected, setSelected] = useState(false)

  // deseleziona cliccando altrove
  useEffect(() => {
    if (!selected) return
    const onDocClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.(`[data-img-key="${nodeKey}"]`)) setSelected(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [selected, nodeKey])

  function setWidth(pct: number | null) {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if (node instanceof ImageNode) node.setWidthPct(pct)
    })
  }

  function setAlign(a: Align) {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if (node instanceof ImageNode) node.setAlign(a)
    })
  }

  function remove() {
    editor.update(() => {
      $getNodeByKey(nodeKey)?.remove()
    })
  }

  const pct = widthPct ?? 100
  const alignBtn = (a: Align) => (
    <button key={a} type="button" onMouseDown={e => e.preventDefault()} onClick={() => setAlign(a)}
      title={a === 'left' ? 'Allinea a sinistra' : a === 'center' ? 'Centra' : 'Allinea a destra'}
      className={`px-1.5 py-1 rounded transition ${align === a ? 'bg-brand text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>
      <AlignIcon kind={a} />
    </button>
  )
  const sizeBtn = (p: number, label: string) => (
    <button key={p} type="button" onMouseDown={e => e.preventDefault()} onClick={() => setWidth(p === 100 ? null : p)}
      className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${pct === p ? 'bg-brand text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}>
      {label}
    </button>
  )

  const marginFor: Record<Align, string> = {
    left: '0 auto 0 0',
    center: '0 auto',
    right: '0 0 0 auto',
  }

  return (
    <span data-img-key={nodeKey} className="relative" style={{ display: 'block', width: `${pct}%`, maxWidth: '100%', margin: marginFor[align] }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src} alt={alt}
        onClick={() => setSelected(true)}
        style={{ width: '100%', height: 'auto', borderRadius: 8, cursor: 'pointer', outline: selected ? '2px solid #6B1F3A' : 'none', outlineOffset: 2 }}
      />
      {selected && (
        <span className="absolute -top-9 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-lg shadow-md px-1.5 py-1 whitespace-nowrap z-10">
          {sizeBtn(25, '25%')}
          {sizeBtn(50, '50%')}
          {sizeBtn(75, '75%')}
          {sizeBtn(100, '100%')}
          <span className="w-px h-4 bg-gray-200 mx-0.5" />
          {alignBtn('left')}
          {alignBtn('center')}
          {alignBtn('right')}
          <span className="w-px h-4 bg-gray-200 mx-0.5" />
          <button type="button" onMouseDown={e => e.preventDefault()} onClick={remove}
            className="px-2 py-0.5 rounded text-[11px] text-red-500 hover:bg-red-50 transition">✕</button>
        </span>
      )}
    </span>
  )
}

class ImageNode extends DecoratorNode<JSX.Element> {
  __src: string
  __alt: string
  __widthPct: number | null
  __align: Align

  static getType(): string { return 'email-image' }
  static clone(node: ImageNode): ImageNode { return new ImageNode(node.__src, node.__alt, node.__widthPct, node.__align, node.__key) }

  constructor(src: string, alt = '', widthPct: number | null = null, align: Align = 'left', key?: NodeKey) {
    super(key)
    this.__src = src
    this.__alt = alt
    this.__widthPct = widthPct
    this.__align = align
  }

  static importDOM(): DOMConversionMap | null {
    return {
      img: () => ({
        conversion: (element: HTMLElement): DOMConversionOutput => {
          const img = element as HTMLImageElement
          // recupera la larghezza % dallo style (formato di export) o dal width attr
          const style = img.getAttribute('style') ?? ''
          const m = style.match(/width:\s*(\d+)%/)
          const pct = m ? Number(m[1]) : null
          const dataAlign = img.getAttribute('data-align') as Align | null
          const align: Align = dataAlign ?? (/margin:[^;]*auto[^;]*auto/.test(style) ? 'center' : /margin-left:\s*auto|margin:\s*0(px)? 0(px)? 0(px)? auto/.test(style) ? 'right' : 'left')
          return { node: new ImageNode(img.getAttribute('src') ?? '', img.getAttribute('alt') ?? '', pct === 100 ? null : pct, align) }
        },
        priority: 0,
      }),
    }
  }

  exportDOM(): DOMExportOutput {
    const img = document.createElement('img')
    img.setAttribute('src', this.__src)
    if (this.__alt) img.setAttribute('alt', this.__alt)
    const pct = this.__widthPct ?? 100
    const margin = this.__align === 'center' ? '8px auto' : this.__align === 'right' ? '8px 0 8px auto' : '8px auto 8px 0'
    img.setAttribute('data-align', this.__align)
    img.setAttribute('style', `display:block;width:${pct}%;max-width:100%;height:auto;border-radius:8px;margin:${margin};`)
    return { element: img }
  }

  static importJSON(json: SerializedImageNode): ImageNode { return new ImageNode(json.src, json.alt, json.widthPct, json.align ?? 'left') }
  exportJSON(): SerializedImageNode {
    return { ...super.exportJSON(), type: 'email-image', src: this.__src, alt: this.__alt, widthPct: this.__widthPct, align: this.__align, version: 1 }
  }

  setWidthPct(pct: number | null): void {
    const writable = this.getWritable()
    writable.__widthPct = pct
  }

  setAlign(align: Align): void {
    const writable = this.getWritable()
    writable.__align = align
  }

  createDOM(_config: EditorConfig): HTMLElement { return document.createElement('span') }
  updateDOM(): boolean { return false }
  isInline(): boolean { return false }

  decorate(): JSX.Element {
    return <ImageComponent src={this.__src} alt={this.__alt} widthPct={this.__widthPct} align={this.__align} nodeKey={this.getKey()} />
  }
}

// ═══ Plugin: carica l'HTML iniziale (una volta per mount) ═══

function HtmlLoaderPlugin({ html }: { html: string }) {
  const [editor] = useLexicalComposerContext()
  const loadedRef = useRef(false)

  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    queueMicrotask(() => {
      editor.update(() => {
        const root = $getRoot()
        root.clear()
        const dom = new DOMParser().parseFromString(html, 'text/html')
        const nodes = $generateNodesFromDOM(editor, dom)
        for (const node of nodes) {
          if ($isElementNode(node) || $isDecoratorNode(node)) root.append(node)
          else { const p = $createParagraphNode(); p.append(node); root.append(p) }
        }
        if (root.getChildrenSize() === 0) root.append($createParagraphNode())
      })
    })
  }, [editor, html])

  return null
}

// ═══ Plugin: espone l'editor al genitore (inserimento variabili) ═══

function EditorRefPlugin({ editorRef }: { editorRef: React.MutableRefObject<LexicalEditor | null> }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => { editorRef.current = editor }, [editor, editorRef])
  return null
}

// ═══ Toolbar ═══

const FONTS = [
  { value: '', label: 'Font' },
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: "'Times New Roman', Times, serif", label: 'Times' },
  { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
  { value: "'Trebuchet MS', sans-serif", label: 'Trebuchet' },
  { value: "'Courier New', monospace", label: 'Courier' },
]

const SIZES = [
  { value: '', label: 'Grandezza' },
  { value: '12px', label: 'Piccolo · 12' },
  { value: '14px', label: 'Normale · 14' },
  { value: '16px', label: 'Medio · 16' },
  { value: '20px', label: 'Grande · 20' },
  { value: '26px', label: 'Titolo · 26' },
  { value: '32px', label: 'Titolone · 32' },
]

function ToolbarPlugin({ imageUploadEndpoint }: { imageUploadEndpoint: string }) {
  const [editor] = useLexicalComposerContext()
  const fileRef = useRef<HTMLInputElement>(null)

  const patchStyle = useCallback((style: Record<string, string | null>) => {
    editor.update(() => {
      const sel = $getSelection()
      if ($isRangeSelection(sel)) $patchStyleText(sel, style)
    })
  }, [editor])

  function insertLink() {
    // legge l'URL PRIMA che il prompt rubi la selezione: Lexical la ripristina da solo
    const url = window.prompt('URL del link (puoi usare una variabile, es. {{booking_url}}):', 'https://')
    if (url === null) return
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, url.trim() === '' || url === 'https://' ? null : url.trim())
  }

  async function handleImageFile(file: File) {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(imageUploadEndpoint, { method: 'POST', body: form })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { window.alert(d.error === 'too_large' ? 'Immagine troppo grande (max 4MB)' : d.error ?? 'Upload fallito'); return }
    editor.update(() => {
      $insertNodes([new ImageNode(d.image_url, file.name)])
    })
  }

  const btn = 'h-7 min-w-7 px-1.5 rounded-md text-xs text-gray-600 hover:bg-gray-200 transition'
  const stop = (e: React.MouseEvent) => e.preventDefault() // non perdere la selezione

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-100 bg-gray-50 flex-wrap">
      <button type="button" onMouseDown={stop} onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)} className={btn} title="Annulla">↺</button>
      <button type="button" onMouseDown={stop} onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)} className={btn} title="Ripristina">↻</button>
      <span className="w-px h-4 bg-gray-200 mx-1" />

      <button type="button" onMouseDown={stop} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')} className={`${btn} font-bold`}>B</button>
      <button type="button" onMouseDown={stop} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')} className={`${btn} italic`}>I</button>
      <button type="button" onMouseDown={stop} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')} className={`${btn} underline`}>U</button>
      <span className="w-px h-4 bg-gray-200 mx-1" />

      {/* font e grandezza */}
      <select onMouseDown={e => e.stopPropagation()} defaultValue=""
        onChange={e => { if (e.target.value) patchStyle({ 'font-family': e.target.value }); e.target.value = '' }}
        className="h-7 px-1 rounded-md border border-gray-200 bg-white text-xs text-gray-600 focus:outline-none">
        {FONTS.map(f => <option key={f.label} value={f.value} style={{ fontFamily: f.value || undefined }}>{f.label}</option>)}
      </select>
      <select onMouseDown={e => e.stopPropagation()} defaultValue=""
        onChange={e => { if (e.target.value) patchStyle({ 'font-size': e.target.value }); e.target.value = '' }}
        className="h-7 px-1 rounded-md border border-gray-200 bg-white text-xs text-gray-600 focus:outline-none">
        {SIZES.map(s => <option key={s.label} value={s.value}>{s.label}</option>)}
      </select>
      <span className="w-px h-4 bg-gray-200 mx-1" />

      {(['left', 'center', 'right'] as const).map(a => (
        <button key={a} type="button" onMouseDown={stop}
          onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, a)}
          className={`${btn} flex items-center justify-center`}
          title={a === 'left' ? 'Allinea a sinistra' : a === 'center' ? 'Centra' : 'Allinea a destra'}>
          <AlignIcon kind={a} />
        </button>
      ))}
      <span className="w-px h-4 bg-gray-200 mx-1" />

      <button type="button" onMouseDown={stop} onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)} className={btn} title="Elenco puntato">•≡</button>
      <button type="button" onMouseDown={stop} onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)} className={btn} title="Elenco numerato">1≡</button>
      <span className="w-px h-4 bg-gray-200 mx-1" />

      <button type="button" onMouseDown={stop} onClick={insertLink} className={btn} title="Inserisci/rimuovi link">🔗 Link</button>
      <button type="button" onMouseDown={stop} onClick={() => fileRef.current?.click()} className={btn} title="Inserisci immagine">🖼 Immagine</button>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = '' }} />
    </div>
  )
}

// ═══ Tema ═══

const theme = {
  paragraph: 'mb-1.5',
  text: { bold: 'font-bold', italic: 'italic', underline: 'underline' },
  link: 'text-brand underline cursor-pointer',
  list: { ul: 'list-disc pl-6 mb-2', ol: 'list-decimal pl-6 mb-2', listitem: 'mb-0.5' },
  heading: {
    h1: 'text-2xl font-bold mb-2', h2: 'text-xl font-bold mb-2', h3: 'text-lg font-semibold mb-1.5',
  },
}

// ═══ Componente ═══

export default function EmailRichEditor({
  initialHtml,
  onChange,
  editorRef,
  imageUploadEndpoint = '/api/hq/email-templates/image',
}: {
  initialHtml: string
  onChange: (html: string) => void
  editorRef: React.MutableRefObject<LexicalEditor | null>
  imageUploadEndpoint?: string
}) {
  const initialConfig = {
    namespace: 'EmailTemplateEditor',
    theme,
    onError: (e: Error) => console.error('[EmailRichEditor]', e),
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, AutoLinkNode, ImageNode],
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 rounded-xl border border-gray-200 overflow-hidden bg-white">
      <LexicalComposer initialConfig={initialConfig}>
        <ToolbarPlugin imageUploadEndpoint={imageUploadEndpoint} />
        <div className="flex-1 overflow-auto relative">
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className="outline-none px-4 py-3 min-h-full text-sm leading-relaxed text-gray-800"
                style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
              />
            }
            placeholder={<div className="absolute top-3 left-4 text-sm text-gray-300 pointer-events-none">Scrivi il testo dell&apos;email…</div>}
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        <HistoryPlugin />
        <ListPlugin />
        <LinkPlugin />
        <HtmlLoaderPlugin html={initialHtml} />
        <EditorRefPlugin editorRef={editorRef} />
        <OnChangePlugin
          ignoreSelectionChange
          onChange={(_state, editor) => {
            editor.getEditorState().read(() => {
              onChange($generateHtmlFromNodes(editor, null))
            })
          }}
        />
      </LexicalComposer>
    </div>
  )
}

// Inserisce testo (es. una variabile {{...}}) alla posizione del cursore
export function insertTextAtCursor(editor: LexicalEditor | null, text: string) {
  if (!editor) return
  editor.focus()
  editor.update(() => {
    const sel = $getSelection()
    if ($isRangeSelection(sel)) sel.insertText(text)
    else {
      const root = $getRoot()
      const last = root.getLastChild()
      if (last && $isElementNode(last)) last.selectEnd()
      $getSelection()?.insertText(text)
    }
  })
}
