'use client'

import { useState } from 'react'
import { categoryEmoji, type ShopProduct } from '@/lib/shop'

// Galleria a foto verticali (formato ritratto, come il sito vetrina).
// `card` = miniatura nella griglia, `detail` = scheda prodotto con provini.
export default function ProductGallery({
  product,
  variant = 'card',
}: {
  product: Pick<ShopProduct, 'name' | 'category' | 'images'>
  variant?: 'card' | 'detail'
}) {
  const [idx, setIdx] = useState(0)
  const images = product.images ?? []
  const isDetail = variant === 'detail'
  const ratio = isDetail ? 'aspect-[4/5]' : 'aspect-[3/4]'

  if (images.length === 0) {
    return (
      <div className={`w-full ${ratio} rounded-xl bg-gray-50 flex items-center justify-center`}>
        <span className={isDetail ? 'text-7xl text-gray-200' : 'text-5xl text-gray-200'}>
          {categoryEmoji[product.category] ?? '🛍️'}
        </span>
      </div>
    )
  }

  const current = Math.min(idx, images.length - 1)

  return (
    <div>
      <div className="relative">
        { }
        {/* Nella card il click sulla foto apre la scheda (il wrapper è un link):
            per scorrere le immagini ci sono i pallini e la freccia. */}
        <img
          src={images[current]}
          alt={product.name}
          className={`w-full ${ratio} object-cover rounded-xl bg-gray-50 ${images.length > 1 ? 'cursor-pointer' : ''}`}
          onClick={() => isDetail && images.length > 1 && setIdx((current + 1) % images.length)}
        />
        {images.length > 1 && (
          <>
            {/* Pallini in basso a sinistra: posizione corrente e salto diretto */}
            <div className="absolute left-3 bottom-3 flex items-center gap-1.5">
              {images.map((_, i) => (
                <button
                  key={i}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIdx(i) }}
                  aria-label={`Image ${i + 1}`}
                  className={`w-1.5 h-1.5 rounded-full transition ${i === current ? 'bg-white' : 'bg-white/50 hover:bg-white/80'}`}
                />
              ))}
            </div>

            {/* Frecce affiancate in basso a destra: prima indietro, poi avanti */}
            <div className="absolute right-3 bottom-3 flex items-center gap-1.5">
              {([['prev', -1], ['next', 1]] as const).map(([dir, step]) => (
                <button
                  key={dir}
                  onClick={(e) => {
                    e.preventDefault(); e.stopPropagation()
                    setIdx((current + step + images.length) % images.length)
                  }}
                  aria-label={dir === 'prev' ? 'Previous image' : 'Next image'}
                  className={`${isDetail ? 'w-8 h-8' : 'w-7 h-7'} rounded-full bg-black/40 hover:bg-black/70 text-white flex items-center justify-center transition`}
                >
                  <svg className={isDetail ? 'w-4 h-4' : 'w-3.5 h-3.5'} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={dir === 'prev' ? 'M15.75 19.5L8.25 12l7.5-7.5' : 'M8.25 4.5l7.5 7.5-7.5 7.5'} />
                  </svg>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {isDetail && images.length > 1 && (
        <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
          {images.map((src, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              className={`shrink-0 w-16 aspect-[4/5] rounded-lg overflow-hidden border-2 transition ${
                i === current ? 'border-brand' : 'border-transparent opacity-60 hover:opacity-100'
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
