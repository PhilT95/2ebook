import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function withTempDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), '2ebook-'))
    try {
        return await work(dir)
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
}

export async function spawnConvert(
    command: string,
    args: string[],
    cwd: string,
    validExitCodes: number[] = [0]
): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd })
        let output = ''

        child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })

        child.once('error', (err) => {
            reject(new Error(`${command} failed to start: ${err.message}`))
        })
        child.once('close', (code) => {
            if (code !== null && validExitCodes.includes(code)) {
                resolve()
            } else {
                reject(new Error(`${command} exited with code ${code}\n${output}`))
            }
        })
    })
}


export async function runKepubify(input: Buffer): Promise<Buffer> {
    return withTempDir(async (dir) => {
        await writeFile(join(dir, 'input.epub'), input)
        await spawnConvert(
            'kepubify',
            ['-v', '-u', '-o', 'output.kepub.epub', 'input.epub'],
            dir,
            [0]
        )
        return readFile(join(dir, 'output.kepub.epub'))
    })
}


export async function runKindlegen(input: Buffer): Promise<Buffer> {
    return withTempDir(async (dir) => {
        await writeFile(join(dir, 'input.epub'), input)
        await spawnConvert(
            'kindlegen',
            ['input.epub', '-dont_append_source', '-c1', '-o', 'output.mobi'],
            dir,
            [0, 1]
        )
        return readFile(join(dir, 'output.mobi'))
    })
}

export async function runPdfCropMargins(input: Buffer): Promise<Buffer> {
    return withTempDir(async (dir) => {
        await writeFile(join(dir, 'input.pdf'), input)
        await spawnConvert(
            'pdfcropmargins',
            ['-s', '-u', '-o', 'output.pdf', 'input.pdf'],
            dir,
            [0]
        )
        return readFile(join(dir, 'output.pdf'))
    })
}


