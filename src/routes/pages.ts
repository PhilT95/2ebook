import type { FastifyPluginAsync } from 'fastify'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PLAUSIBLE_SCRIPT_URL } from '../config.js'

const EREADER_MARKERS = ['Kobo', 'Kindle', 'tolino', 'eReader']

const ANALYTICS_NOTICE = 'This site counts page visits with Plausible, a privacy-friendly analytics tool that uses no cookies. Your ebook, its filename and your key are not sent to it.'

// Adds the analytics script and privacy notice to the upload page

function addAnalytics(html: string, scriptUrl: string): string {
    const snippet = `<!-- Privacy-friendly analytics by Plausible -->
<script async src="${scriptUrl}"></script>
<script>
  window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};
  plausible.init()
</script>`
    return html
        .replace('</head>', () => `${snippet}\n</head>`)
        .replace('<!-- analytics-notice -->', () => ANALYTICS_NOTICE)
}

const pagesRoute: FastifyPluginAsync = async (app) => {
    const uploadPath = join(import.meta.dirname, '..', '..', 'static', 'upload.html')
    const uploadWithAnalytics = PLAUSIBLE_SCRIPT_URL
        ? addAnalytics(await readFile(uploadPath, 'utf8'), PLAUSIBLE_SCRIPT_URL)
        : null

    app.get('/receive', (_request, reply) => reply.sendFile("download.html"))

    app.get('/', (request, reply) => {
        const agent = request.headers['user-agent'] ?? ''
        const isEreader = EREADER_MARKERS.some((m) => agent.toLowerCase().includes(m.toLowerCase()))
        if (isEreader) return reply.sendFile('download.html')
        if (uploadWithAnalytics) return reply.type('text/html; charset=utf-8').send(uploadWithAnalytics)
        return reply.sendFile('upload.html')
    })
}

export default pagesRoute