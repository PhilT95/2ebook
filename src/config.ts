export const PORT               = Number(process.env.PORT) || 3001
export const EXPIRE_DELAY       = 30
export const MAX_EXPIRE         = 60 * 60 // hard session cap
export const MAX_FILE_SIZE      = 100 * 1024 * 1024 // 100 MB

export const ALLOWED_TYPES      = []
export const ALLOWED_EXTENSIONS = []

export const KEY_CHARS          = "23456789ACDEFGHJKLMNPRSTUVWXYZ"
export const KEY_LENGTH         = 6
