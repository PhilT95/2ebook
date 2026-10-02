import { randomUUID } from 'node:crypto'
import { extname, join } from 'node:path'
import type { FastifyPluginAsync } from 'fastify'
import { fileTypeFromBuffer } from 'file-type'
import sanitize from 'sanitize-filename'
import { ALLOWED_EXTENSIONS, ALLOWED_TYPES, MAX_FILE_SIZE, TYPE_EPUB, UPLOADS_DIR } from '../config.js'
import { runKepubify, runKindlegen, runPdfCropMargins } from '../lib/convert.js'
import { encryptToFile } from '../lib/crypto.js'
import { doTransliterate, kindleSafeFilename } from '../lib/filename.js'
import { discardFile, expireKey, sessions } from '../lib/keys.js'


interface UploadedFile {
    filename: string
    mimetype: string
    data: Buffer
}

interface PreparedFile {
    filename: string
    data: Buffer
    conversion: string | null
}

class UploadError extends Error {
    status: number
    constructor(message: string, status = 400) {
        super(message)
        this.status = status
    }
}


function toHttpUrl(raw: string): string | null {
    try {
        const url = new URL(raw)
        return url.protocol === 'http:' || url.protocol === 'https:' ? raw : null
    } catch {
        return null
    }
}

function describeConversionError(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err)
    return message.replaceAll(/\S*2ebook-[A-Za-z0-9]+\/?/g, '')
}


async function prepareFile(
    upload: UploadedFile,
    fields: Map<string, string>,
    agent: string
): Promise<PreparedFile> {
    if (upload.data.length === 0) throw new UploadError('Invalid file submitted (empty file)')
    
    let filename = sanitize(upload.filename)
    const extension = extname(filename).slice(1).toLowerCase()

    // Detect the real type from the file's first bytes, not from what the browser claims
    const detected = await fileTypeFromBuffer(upload.data)
    let mimetype = upload.mimetype
    if (mimetype === 'application/octet-stream' && detected) mimetype = detected.mime
    if (mimetype === 'application/epub') mimetype = TYPE_EPUB

    const typeAllowed = (detected && ALLOWED_TYPES.includes(detected.mime)) || ALLOWED_TYPES.includes(mimetype)
    if (!ALLOWED_EXTENSIONS.includes(extension) || !typeAllowed) {
        throw new UploadError(`Uploaded file is of an invalid type: ${filename} (${detected?.mime ?? 'unknown mimetype'})`)
    }

    if (fields.has('transliteration')) filename = sanitize(doTransliterate(filename))
    if (agent.includes('Kindle')) filename = kindleSafeFilename(filename)
    
    let data = upload.data
    let conversion: string | null = null

    try {
        if (mimetype === TYPE_EPUB && agent.includes('Kindle') && fields.has('kindlegen')) {
            conversion = 'kindlegen'
            data = await runKindlegen(data)
            filename = filename.replace(/\.kepub\.epub$/i, '.epub').replace(/\.epub$/i, '.mobi')
        } else if (mimetype === TYPE_EPUB && agent.includes('Kobo') && fields.has('kepubify')) {
            conversion = 'kepubify'
            data = await runKepubify(data)
            filename = filename.replace(/\.kepub\.epub$/i, '.epub').replace(/\.epub$/i, '.kepub.epub')
        } else if (mimetype === 'application/pdf' && fields.has('pdfcropmargins')) {
            conversion = 'pdfcropmargins'
            data = await runPdfCropMargins(data)
        } else {
            filename = filename.replace(/\.epub$/i, '.epub').replace(/\.pdf$/i, '.pdf')
        }
    } catch (err) {
        throw new UploadError(describeConversionError(err), 422)
    }

    return { filename, data, conversion}
}


const uploadRoute: FastifyPluginAsync = async (app) => {
    app.post('/upload', async (request, reply) => {
        const fields = new Map<string, string>()
        let upload: UploadedFile | null = null

        try {
            for await (const part of request.parts()) {
                if (part.type === 'field') {
                    fields.set(part.fieldname, String(part.value))
                } else if (part.filename === '' || !sessions.has((fields.get('key') ?? '').toUpperCase())) {
                    part.file.resume()
                } else {
                    upload = { filename: part.filename, mimetype: part.mimetype, data: await part.toBuffer()}
                }
            }
        } catch (err) {
            if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
                return reply.code(413).send(`File too large (maximum ${MAX_FILE_SIZE / 1024 / 1024} MB)`)
            }
            throw err
        }

        try {
            const key = (fields.get('key') ?? '').toUpperCase()
            const info = sessions.get(key)
            if (!info) throw new UploadError(`Unknown key ${key}`)
            expireKey(key)
            
            const rawUrl = (fields.get('url') ?? '').trim()
            const url = rawUrl ? toHttpUrl(rawUrl): null
            if (rawUrl && !url) throw new UploadError('Invalid url (only http and https are supported)')
            if (!upload && !url) throw new UploadError('No file or url selected')
            
            const prepared = upload ? await prepareFile(upload, fields, info.agent) : null

            expireKey(key)
            if (sessions.get(key) !== info) throw new UploadError('Key expired while uploading')

            if (prepared) {
                await discardFile(info)
                const encryptedPath = join(UPLOADS_DIR, `${randomUUID()}.enc`)
                const meta = await encryptToFile(prepared.data, encryptedPath)
                info.file = { name: prepared.filename, encryptedPath, ...meta, uploaded: new Date() }
            }

            if (url && !info.urls.includes(url)) info.urls.push(url)

            const messages: string[] = []
            if (prepared) {
                const device = info.agent.includes('Kobo') ? 'a Kobo device' : info.agent.includes('Kindle') ? 'a Kindle device' : 'a device'
                const how = prepared.conversion ? `Ebook was converted with ${prepared.conversion} and sent` : 'Sent'
                messages.push(`Upload successful! ${how} to ${device}.` , `Filename: ${prepared.filename}`)
            }
            if (url) messages.push(`Added URL: ${url}`)
            return messages.join('\n')
        } catch (err) {
            if (err instanceof UploadError) return reply.code(err.status).send(err.message)
            throw err
        }
    })

}

export default uploadRoute