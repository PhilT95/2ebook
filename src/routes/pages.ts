import type { FastifyPluginAsync } from 'fastify'

const EREADER_MARKERS = ['Kobo', 'Kindle', 'tolino', 'eReader']

const pagesRoute: FastifyPluginAsync = async (app) => {
    app.get('/receive', (_request, reply) => reply.sendFile("download.html"))

    app.get('/', (request, reply) => {
        const agent = request.headers['user-agent'] ?? ''
        const isEreader = EREADER_MARKERS.some((m) => agent.toLowerCase().includes(m.toLowerCase()))
        return reply.sendFile(isEreader ? 'download.html' : 'upload.html')
    })
}

export default pagesRoute