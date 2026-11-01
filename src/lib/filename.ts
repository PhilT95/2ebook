import { extname, parse } from 'node:path'
import sanitize from 'sanitize-filename'
import { transliterate } from 'transliteration'

// Below the usual 255-byte limit, leaving room for the .kepub.epub rename
const MAX_FILENAME_BYTES = 240
const FALLBACK_NAME = 'ebook'

export function doTransliterate(filename: string): string {
    const { name, ext } = parse(filename)
    return transliterate(name) + ext
}


// replace every character that is not one of ., a letter or digit or underscore (\w), -, ", ', ( or ) with _.
export function kindleSafeFilename(filename: string): string {
    return filename.replace(/[^.\w\-"'()]/g, '_')
}


// Sanitizes a filename but always keeps its extension. Shortens only the part
// before it, on a whole character, and falls back to a default if nothing is left.
export function safeFilename(filename: string): string {
    const rawExt = extname(filename)
    const ext = sanitize(rawExt)
    const stem = sanitize(filename.slice(0, filename.length - rawExt.length))

    let shortened = ''
    let bytes = Buffer.byteLength(ext)
    for (const char of stem) {
        bytes += Buffer.byteLength(char)
        if (bytes > MAX_FILENAME_BYTES) break
        shortened += char
    }

    return `${shortened.trim() || FALLBACK_NAME}${ext}`
}