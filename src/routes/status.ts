import type { FastifyPluginAsync } from 'fastify'
import { expireKey, getEreaderSession } from '../lib/keys.js'

const statusRoute: FastifyPluginAsync = async (app) => {
    app.get<{ Params: {key: string } }>('/status/:key', async (request, reply) => {
        const info = getEreaderSession(request.params.key, request.headers['user-agent'])
        if (!info) return reply.code(404).send({ error: 'Unknown key' })

        expireKey(request.params.key.toUpperCase())

        return {
            alive: info.alive,
            file: info.file ? { name: info.file.name } : null,
            urls: info.urls
        }
    })
}

export default statusRoute