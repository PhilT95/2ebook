import type { FastifyPluginAsync } from 'fastify'
import { discardFile, getEreaderSession } from '../lib/keys.js'

const deleteFileRoute: FastifyPluginAsync = async (app) => {
    app.delete<{ Params: { key: string } }>('/file/:key', async (request, reply) => {
        const info = getEreaderSession(request.params.key, request.headers['user-agent'])
        if (!info) return reply.code(404).send({ error: 'Unknown key'})

        await discardFile(info)
        return 'ok'
    })
}

export default deleteFileRoute