import { randomInt } from 'node:crypto'
import { EXPIRE_DELAY, KEY_CHARS, KEY_LENGTH } from '../config.js'
import { unlink } from 'node:fs/promises'
import type { SessionInfo } from '../types.js'


// The entire session database. Lives in memory for the lifetime of the process.
export const sessions = new Map<string,SessionInfo>()


// Generates a cryptographically random 6-character key
export function randomKey(): string {
    let key = ''
    for (let i = 0; i < KEY_LENGTH; i++) {
        key += KEY_CHARS[randomInt(KEY_CHARS.length)]
    }
    return key
}

// Resets the 30-second inactivity timer for a session
export function expireKey(key: string): void {
    const info = sessions.get(key)
    if (!info) return

    if (info.timer) clearTimeout(info.timer)
    info.timer = setTimeout(() => { void removeKey(key) }, EXPIRE_DELAY * 1000)
    info.alive = new Date()
}


// Fully removes a session and deletes its encrypted file from disk
export async function removeKey(key: string): Promise<void> {
    const info = sessions.get(key)
    if (!info) return

    if (info.timer) clearTimeout(info.timer)
    sessions.delete(key)

    await discardFile(info)
}

// Finds a session and checks the request comes from the same ereader.
// Returns undefined for "unknown key" AND "wrong device", so callers
// cannot tell the two apart (and neither can the attacker)
export function getEreaderSession(key: string, userAgent: string | undefined): SessionInfo | undefined {
    const info = sessions.get(key.toUpperCase())
    if (!info || info.agent !== (userAgent ?? '')) return undefined
    return info
}

// Deletes only the stored file, keeping the session alive
export async function discardFile(info: SessionInfo): Promise<void> {
    const file = info.file
    if (!file) return
    info.file = null
    file.key.fill(0)
    try {
        await unlink(file.encryptedPath)
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.error('Could not delete', file.encryptedPath, err)
        }
    }
}