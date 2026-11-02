import type { FastifyPluginAsync } from 'fastify'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PLAUSIBLE_ENABLED } from '../config.js'

const EREADER_MARKERS = ['Kobo', 'Kindle', 'tolino', 'eReader']

const ANALYTICS_NOTICE = 'This site uses Plausible, a privacy-friendly analytics tool without cookies, to count page visits, form submissions and clicks on external links, and to measure how far and how long pages are viewed. Your ebook, its filename and your key are not sent to it.'

const ANALYTICS_SNIPPET = `<!-- Privacy-friendly analytics by Plausible -->
<script async src="/js/script.js"></script>
<script>
  window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};
  plausible.init({
    endpoint: "/api/event"
  })
</script>`

// Adds the analytics script and privacy notice to the upload page
function addAnalytics(html: string): string {
    return html
        .replace('</head>', () => `${ANALYTICS_SNIPPET}\n</head>`)
        .replace('<!-- analytics-notice -->', () => ANALYTICS_NOTICE)
}

const pagesRoute: FastifyPluginAsync = async (app) => {
    const uploadPath = join(import.meta.dirname, '..', '..', 'static', 'upload.html')
    const uploadWithAnalytics = PLAUSIBLE_ENABLED
        ? addAnalytics(await readFile(uploadPath, 'utf8'))
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