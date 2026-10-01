export interface FileInfo {
    name: string
    encryptedPath: string
    key: Buffer
    iv: Buffer
    authTag: Buffer
    uploaded: Date
}

export interface SessionInfo {
    created: Date
    agent: string
    file: FileInfo | null
    urls: string[]
    timer: ReturnType<typeof setTimeout> | null
    alive: Date
}