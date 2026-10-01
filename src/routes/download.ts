import { extname } from 'node:path'
import type { FastifyPluginAsync } from 'fastify'
import { MIME_BY_EXTENSION } from '../config.js'
import { decryptFromFile } from '../lib/crypto.js'
import { expireKey, getEreaderSession } from '../lib/keys.js'

const downloadRoute: FastifyPluginAsync = async (app) => {
    app.get<{ Params: { filename: string }; Querystring: { key?: string } }>(
        '/:filename',
        async (request, reply) => {
            const { key } = request.query
            if (typeof key !== 'string') return reply.code(404).send('Not found')

            const info = getEreaderSession(key, request.headers['user-agent'])
            const file = info?.file
            if (!info || !file || file.name !== request.params.filename) {
                return reply.code(404).send('Not found')
            }

            expireKey(key.toUpperCase())

            const plainText = await decryptFromFile(file.encryptedPath, file)
            const mime = MIME_BY_EXTENSION[extname(file.name).toLowerCase()] ?? 'application/octet-stream'

            if (info.agent.includes('Kindle')) {
                reply.header('content-disposition', `attachment; filename="${file.name}"`)
            }

            return reply
                .type(mime)
                .header('x-content-type-options', 'nosniff')
                .header('content-security-policy', 'sandbox')
                .send(plainText)
        }
    )
}


export default downloadRoute