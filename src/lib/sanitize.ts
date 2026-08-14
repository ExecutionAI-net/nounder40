import DOMPurify from 'dompurify'

export function sanitizeInput(input: string): string {
  if (typeof window === 'undefined') {
    return input
  }
  return DOMPurify.sanitize(input, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })
}

export function sanitizeHtml(html: string): string {
  if (typeof window === 'undefined') {
    return html
  }
  return DOMPurify.sanitize(html, { ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'br', 'p', 'a', 'ul', 'li', 'ol'], ALLOWED_ATTR: ['href', 'target', 'rel'] })
}
