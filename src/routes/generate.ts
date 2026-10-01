import type { FastifyPluginAsync } from 'fastify'
import { EXPIRE_DELAY, MAX_EXPIRE } from '../config.js'
import { expireKey, randomKey, removeKey, sessions } from '../lib/keys.js'
import type { SessionInfo } from '../types.js'

const generateRoute: FastifyPluginAsync = async (app) => {
    app.post(
        '/generate',
        { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
        async (request, reply) => {
            let key = randomKey()
            for (let attempt = 0; sessions.has(key); attempt++) {
                if (attempt >= 100) return reply.code(503).send('error')
                key = randomKey()
            }

            const info: SessionInfo = {
                created: new Date(),
                agent: request.headers['user-agent'] ?? '',
                file: null,
                urls: [],
                timer: null,
                alive: new Date()
            }

            sessions.set(key, info)
            expireKey(key)

            setTimeout(() => {
                if(sessions.get(key) === info) void removeKey(key)
            }, MAX_EXPIRE * 1000)

            reply.setCookie('key', key, { sameSite: 'strict', maxAge: EXPIRE_DELAY, path: '/'})
            return key
        }
    )
}

export default generateRoute