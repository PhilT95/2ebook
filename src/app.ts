import Fastify from "fastify"
import staticPlugin from "@fastify/static"
import multipart from "@fastify/multipart"
import rateLimit from "@fastify/rate-limit"
import cookie from "@fastify/cookie"
import { MAX_FILE_SIZE, TRUST_PROXY } from "./config.js"
import { join } from 'node:path'
import generateRoute from './routes/generate.js'
import statusRoute from './routes/status.js'
import deleteFileRoute from './routes/deleteFile.js'
import pagesRoute from './routes/pages.js'
import downloadRoute from "./routes/download.js"
import uploadRoute from "./routes/upload.js"

export function buildApp() {
    const app = Fastify({
        logger: true, // built-in structured logging
        routerOptions: {maxParamLength: 1024},
        // Trust only the proxy connecting to us, so the rate limit uses the last address it added
        trustProxy: TRUST_PROXY ? (_address, hop) => hop === 0 : false
    })

    app.register(cookie)
    app.register(rateLimit, { max: 60, timeWindow: '1 minute'})
    app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE, files: 1}})
    app.register(staticPlugin, { 
        root: join(import.meta.dirname, '..', 'static'),
        wildcard: false,
        index: false
    })

    // Register route modules

    app.register(generateRoute)
    app.register(pagesRoute)
    app.register(uploadRoute)
    app.register(statusRoute)
    app.register(downloadRoute)
    app.register(deleteFileRoute)

    return app

}