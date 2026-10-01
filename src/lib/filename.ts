import { parse } from 'node:path'
import { transliterate } from 'transliteration'

export function doTransliterate(filename: string): string {
    const { name, ext } = parse(filename)
    return transliterate(name) + ext
}


// replace every character that is not one of ., a letter or digit or underscore (\w), -, ", ', ( or ) with _.
export function kindleSafeFilename(filename: string): string {
    return filename.replace(/[^.\w\-"'()]/g, '_')
}