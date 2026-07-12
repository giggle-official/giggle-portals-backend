#!/usr/bin/env node
// End-to-end test for video asset upload + registration.
//
// Reproduces the exact production flow that hits AssetsService.processNewVideo:
//   1) POST /api/v1/assets/get-presigned-url  → signed PUT URL + object_key
//   2) PUT  <signed_url>                      → upload the video bytes to S3
//   3) POST /api/v1/assets/register           → server-side ffprobe / thumbnail
//
// Usage:
//   BASE_URL=http://localhost:3000 \
//   API_KEY=<user_api_key> \
//   VIDEO_PATH=./sample.mp4 \
//   node scripts/test-video-upload.mjs
//
// Optional env:
//   ASSET_NAME    default: basename of VIDEO_PATH
//   CONTENT_TYPE  default: inferred from extension (mp4/mov/mkv/webm/m4v)
//   IS_PUBLIC     "1" or "true" to upload to public bucket (default: false)
//   TIMEOUT_MS    per-request timeout, default 120000 (2 min)

import { readFile, stat } from "node:fs/promises"
import { basename, extname } from "node:path"
import { performance } from "node:perf_hooks"

const {
    BASE_URL,
    API_KEY,
    VIDEO_PATH,
    ASSET_NAME,
    CONTENT_TYPE,
    IS_PUBLIC,
    TIMEOUT_MS = "120000",
} = process.env

function die(msg) {
    console.error(`\x1b[31m✗ ${msg}\x1b[0m`)
    process.exit(1)
}

if (!BASE_URL) die("BASE_URL not set (e.g. http://localhost:3000)")
if (!API_KEY) die("API_KEY not set")
if (!VIDEO_PATH) die("VIDEO_PATH not set (path to a local video file)")

const timeoutMs = Number(TIMEOUT_MS)
const isPublic = /^(1|true|yes)$/i.test(IS_PUBLIC || "")

const CONTENT_TYPE_MAP = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".m4v": "video/x-m4v",
}

const inferredContentType =
    CONTENT_TYPE || CONTENT_TYPE_MAP[extname(VIDEO_PATH).toLowerCase()] || "video/mp4"
const fileName = basename(VIDEO_PATH)
const assetName = ASSET_NAME || fileName

async function withTimeout(promise, label) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        return await promise(controller.signal)
    } catch (err) {
        if (err.name === "AbortError") throw new Error(`${label} timed out after ${timeoutMs}ms`)
        throw err
    } finally {
        clearTimeout(timer)
    }
}

async function step(label, fn) {
    const t0 = performance.now()
    process.stdout.write(`→ ${label} ... `)
    try {
        const result = await fn()
        const dt = (performance.now() - t0).toFixed(0)
        console.log(`\x1b[32mok\x1b[0m (${dt}ms)`)
        return result
    } catch (err) {
        const dt = (performance.now() - t0).toFixed(0)
        console.log(`\x1b[31mfail\x1b[0m (${dt}ms)`)
        console.error(`  ${err.message}`)
        if (err.body) console.error(`  body: ${err.body}`)
        throw err
    }
}

async function jsonPost(path, body) {
    return withTimeout(async (signal) => {
        const res = await fetch(`${BASE_URL}${path}`, {
            method: "POST",
            headers: { "x-api-key": API_KEY, "content-type": "application/json" },
            body: JSON.stringify(body),
            signal,
        })
        const text = await res.text()
        if (!res.ok) {
            const err = new Error(`HTTP ${res.status} on POST ${path}`)
            err.body = text.slice(0, 2000)
            throw err
        }
        try {
            const json = JSON.parse(text)
            // Backend wraps responses as { code, msg, data }; unwrap if present.
            if (json && typeof json === "object" && "code" in json && "data" in json) {
                if (json.code !== 200) {
                    const err = new Error(`Business error code=${json.code} msg=${json.msg}`)
                    err.body = text.slice(0, 2000)
                    throw err
                }
                return json.data
            }
            return json
        } catch {
            return text
        }
    }, `POST ${path}`)
}

async function main() {
    console.log(`Base URL:      ${BASE_URL}`)
    console.log(`File:          ${VIDEO_PATH}`)
    console.log(`Content-Type:  ${inferredContentType}`)
    console.log(`Public bucket: ${isPublic}`)
    console.log()

    const fileInfo = await step("stat local file", async () => {
        const s = await stat(VIDEO_PATH)
        if (!s.isFile()) throw new Error(`${VIDEO_PATH} is not a regular file`)
        return { size: s.size }
    })
    console.log(`  size: ${(fileInfo.size / 1024 / 1024).toFixed(2)} MiB`)

    const { object_key, signed_url } = await step("get presigned URL", () =>
        jsonPost("/api/v1/assets/get-presigned-url", {
            file_name: fileName,
            content_type: inferredContentType,
            is_public: isPublic,
        }),
    )
    console.log(`  object_key: ${object_key}`)

    const buf = await step("read file into memory", () => readFile(VIDEO_PATH))

    await step("PUT upload to S3", () =>
        withTimeout(async (signal) => {
            const res = await fetch(signed_url, {
                method: "PUT",
                headers: {
                    "content-type": inferredContentType,
                    "content-length": String(buf.byteLength),
                },
                body: buf,
                signal,
            })
            if (!res.ok) {
                const err = new Error(`S3 PUT failed HTTP ${res.status}`)
                err.body = (await res.text()).slice(0, 2000)
                throw err
            }
            return true
        }, "S3 PUT"),
    )

    const asset = await step("register asset (triggers processNewVideo)", () =>
        jsonPost("/api/v1/assets/register", {
            object_key,
            name: assetName,
        }),
    )

    console.log()
    console.log("\x1b[32m✓ Registration succeeded.\x1b[0m")
    console.log(JSON.stringify(asset, null, 2))
}

main().catch((err) => {
    console.error()
    console.error("\x1b[31m✗ FAILED\x1b[0m")
    console.error(err?.stack || err)
    process.exit(1)
})
