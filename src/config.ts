import { join } from 'node:path'

export const PORT               = Number(process.env.PORT) || 3001
export const EXPIRE_DELAY       = 30
export const MAX_EXPIRE         = 60 * 60 // hard session cap
export const MAX_FILE_SIZE      = 100 * 1024 * 1024 // 100 MB

export const TYPE_EPUB          = 'application/epub+zip'
export const TYPE_MOBI          = 'application/x-mobipocket-ebook'


export const ALLOWED_TYPES: string[]      = [
    TYPE_EPUB, TYPE_MOBI, 'application/pdf', 'application/vnd.comicbook+zip',
    'application/vnd.comicbook-rar', 'text/html', 'text/plain', 'application/zip', 'application/x-rar-compressed'
]
export const ALLOWED_EXTENSIONS: string[] = ['epub', 'mobi', 'pdf', 'cbz', 'cbr', 'html', 'txt']

export const KEY_CHARS          = "23456789ACDEFGHJKLMNPRSTUVWXYZ"
export const KEY_LENGTH         = 6

export const MIME_BY_EXTENSION: Record<string, string | undefined> = {
    '.epub': TYPE_EPUB,
    '.mobi': TYPE_MOBI,
    '.pdf':  'application/pdf',
    '.cbz':  'application/vnd.comicbook+zip',
    '.cbr':  'application/vnd.comicbook-rar',
    '.html': 'text/html',
    '.txt':  'text/plain'
}

export const UPLOADS_DIR = join(import.meta.dirname, '..', 'uploads')