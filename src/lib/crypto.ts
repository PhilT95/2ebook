import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto"
import { readFile, writeFile } from 'node:fs/promises'

export interface EncryptionMeta {
    key: Buffer
    iv: Buffer
    authTag: Buffer
}


// Encrypts a Buffer in memory and writes the ciphertext to a file on disk.
// Returns the key, IV and auth tag. The caller stores these in the session Map (RAM only)
export async function encryptToFile(
    plaintext: Buffer,
    filePath: string
): Promise<EncryptionMeta> {
    const key = randomBytes(32)
    const iv = randomBytes(12)

    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const authTag = cipher.getAuthTag()

    await writeFile(filePath, ciphertext, { mode: 0o600 })

    return {key, iv, authTag}
}


// Reads an encrypted file from disk and decrypts it in memory.
// Throws if the key/IV/authTag don't match. (file tampered or wrong session)
export async function decryptFromFile(
    filePath: string,
    meta: EncryptionMeta
): Promise<Buffer> {
    const ciphertext = await readFile(filePath)

    const decipher = createDecipheriv('aes-256-gcm', meta.key, meta.iv)
    decipher.setAuthTag(meta.authTag)

    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}
