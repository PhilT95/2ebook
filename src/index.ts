import { mkdir, rm } from 'node:fs/promises'
import { buildApp } from './app.js'
import { PORT, UPLOADS_DIR } from './config.js'

// Wipe leftovers from a previous run, then recreate the empty folder
await rm(UPLOADS_DIR, { recursive: true, force: true})
await mkdir(UPLOADS_DIR, { recursive: true, mode: 0o700})

const app = buildApp()

try {
    await app.listen({ port: PORT, host: '0.0.0.0' })
} catch (err) {
    app.log.error(err)
    process.exit(1)
}

// Docker sends SIGTERM on `docker stop`, CTRL+C send SIGINT
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
        await app.close()
        await rm(UPLOADS_DIR, { recursive: true, force: true})
        process.exit(0)
    })
}